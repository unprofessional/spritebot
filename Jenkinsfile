void notifyGithubStatus(String state, String description) {
  withCredentials([
    usernamePassword(
      credentialsId: 'github_username_plus_personal_token',
      passwordVariable: 'GITHUB_TOKEN',
      usernameVariable: 'GITHUB_USER',
    ),
  ]) {
    sh """
      set +x
      status_payload="\$(mktemp)"
      trap 'rm -f "\$status_payload"' EXIT

      cat > "\$status_payload" <<'JSON'
{"state":"${state}","target_url":"${env.BUILD_URL}","description":"${description}","context":"ci/jenkins/spritebot"}
JSON

      curl -sS -f \
        -u "\$GITHUB_USER:\$GITHUB_TOKEN" \
        -H 'Accept: application/vnd.github+json' \
        -H 'X-GitHub-Api-Version: 2022-11-28' \
        --data-binary @"\$status_payload" \
        "https://api.github.com/repos/unprofessional/spritebot/statuses/${env.GIT_COMMIT}" \
        >/dev/null || echo 'GitHub status notification failed'
    """
  }
}

boolean isDeployBranch() {
  return ['main', 'master', 'origin/main', 'origin/master'].contains(env.GIT_BRANCH) ||
    ['main', 'master'].contains(env.BRANCH_NAME)
}

boolean isPrettierOnlyPath(String path) {
  return path == 'README.md' ||
    path == 'INSTRUCTIONS.md' ||
    path == 'AGENTS.md' ||
    path == 'LICENSE' ||
    path == '.env.example' ||
    path == '.gitignore' ||
    path == '.prettierignore' ||
    path == '.dockerignore' ||
    path.startsWith('docs/') ||
    path.startsWith('plans/') ||
    path.endsWith('.md')
}

boolean isCiConfigOnlyPath(String path) {
  return path == 'Jenkinsfile' || path.startsWith('.github/')
}

boolean isSourceLintPath(String path) {
  return path.startsWith('src/') ||
    path == 'eslint.config.js' ||
    path == 'tsconfig.json' ||
    path == 'package.json' ||
    path == 'package-lock.json'
}

boolean isTestImpactingPath(String path) {
  return path.startsWith('src/') ||
    path.startsWith('tests/') ||
    path == 'jest.config.js' ||
    path == 'tsconfig.json' ||
    path == 'package.json' ||
    path == 'package-lock.json'
}

boolean isBuildImpactingPath(String path) {
  return path.startsWith('src/') ||
    path == 'tsconfig.json' ||
    path == 'package.json' ||
    path == 'package-lock.json'
}

boolean isDockerImpactingPath(String path) {
  return isBuildImpactingPath(path) ||
    path == 'Dockerfile' ||
    path == 'docker-compose.yml' ||
    path == 'entrypoint.sh'
}

boolean isDeployImpactingPath(String path) {
  return isDockerImpactingPath(path)
}

boolean isKnownCiPath(String path) {
  return isPrettierOnlyPath(path) ||
    isCiConfigOnlyPath(path) ||
    isSourceLintPath(path) ||
    isTestImpactingPath(path) ||
    isBuildImpactingPath(path) ||
    isDockerImpactingPath(path)
}

pipeline {
  agent any

  tools {
    nodejs 'NodeJS 22.22'
  }

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  triggers {
    githubPush()
  }

  environment {
    DEPLOY_HOST = 'shinralabs'
    DEPLOY_REMOTE_DIR = 'dev/spritebot'
    DEPLOY_ARCHIVE = 'spritebot-deploy.tar.gz'
    CI_CHECK_PROFILE = 'full'
    RUN_ESLINT = 'true'
    RUN_TESTS = 'true'
    RUN_BUILD = 'true'
    RUN_DOCKER_BUILD = 'true'
    RUN_PACKAGE_DEPLOY = 'true'
  }

  stages {
    stage('Prepare Workspace') {
      steps {
        sh 'rm -f "$DEPLOY_ARCHIVE"'
      }
    }

    stage('Report Jenkins Pending') {
      steps {
        script {
          notifyGithubStatus('pending', 'Jenkins build is running')
        }
      }
    }

    stage('Classify Changes') {
      steps {
        script {
          String changedFilesOutput = sh(
            returnStdout: true,
            script: '''
              set -eu

              if [ -n "${CHANGE_TARGET:-}" ]; then
                git fetch --no-tags origin "+refs/heads/${CHANGE_TARGET}:refs/remotes/origin/${CHANGE_TARGET}" >/dev/null 2>&1 || true

                if git rev-parse --verify "origin/${CHANGE_TARGET}" >/dev/null 2>&1; then
                  git diff --name-only "origin/${CHANGE_TARGET}"...HEAD
                  exit 0
                fi
              fi

              if [ -n "${GIT_PREVIOUS_SUCCESSFUL_COMMIT:-}" ] &&
                git cat-file -e "${GIT_PREVIOUS_SUCCESSFUL_COMMIT}^{commit}" 2>/dev/null; then
                git diff --name-only "${GIT_PREVIOUS_SUCCESSFUL_COMMIT}" HEAD
                exit 0
              fi

              if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
                git diff --name-only HEAD~1 HEAD
              else
                git ls-files
              fi
            ''',
          ).trim()

          List<String> changedFiles = changedFilesOutput
            ? changedFilesOutput.split('\\n').collect { it.trim() }.findAll { it }
            : []

          if (changedFiles.isEmpty()) {
            echo 'No changed files detected; running the full CI profile.'
          } else {
            echo "Changed files:\\n${changedFiles.join('\\n')}"
          }

          boolean lightweightOnly = !changedFiles.isEmpty() &&
            changedFiles.every { isPrettierOnlyPath(it) || isCiConfigOnlyPath(it) }
          boolean hasUnknownPaths = changedFiles.any { !isKnownCiPath(it) }

          if (lightweightOnly) {
            env.CI_CHECK_PROFILE = 'prettier-only'
            env.RUN_ESLINT = 'false'
            env.RUN_TESTS = 'false'
            env.RUN_BUILD = 'false'
            env.RUN_DOCKER_BUILD = 'false'
            env.RUN_PACKAGE_DEPLOY = 'false'
          } else if (hasUnknownPaths) {
            env.CI_CHECK_PROFILE = 'full'
            echo 'Unknown changed paths detected; keeping the full CI profile.'
          } else if (!changedFiles.isEmpty()) {
            env.CI_CHECK_PROFILE = 'selective'
            env.RUN_ESLINT = changedFiles.any { isSourceLintPath(it) }.toString()
            env.RUN_TESTS = changedFiles.any { isTestImpactingPath(it) }.toString()
            env.RUN_BUILD = changedFiles.any { isBuildImpactingPath(it) }.toString()
            env.RUN_DOCKER_BUILD = changedFiles.any { isDockerImpactingPath(it) }.toString()
            env.RUN_PACKAGE_DEPLOY = changedFiles.any { isDeployImpactingPath(it) }.toString()
          }

          echo "CI profile: ${env.CI_CHECK_PROFILE}"
          echo "RUN_ESLINT=${env.RUN_ESLINT}, RUN_TESTS=${env.RUN_TESTS}, RUN_BUILD=${env.RUN_BUILD}, RUN_DOCKER_BUILD=${env.RUN_DOCKER_BUILD}, RUN_PACKAGE_DEPLOY=${env.RUN_PACKAGE_DEPLOY}"
        }
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Prettier') {
      steps {
        sh 'npm run lint:prettier'
      }
    }

    stage('ESLint') {
      when {
        expression { env.RUN_ESLINT == 'true' }
      }

      steps {
        sh 'npm run lint:eslint'
      }
    }

    stage('Test') {
      when {
        expression { env.RUN_TESTS == 'true' }
      }

      steps {
        sh 'npm test -- --runInBand'
      }
    }

    stage('Build') {
      when {
        expression { env.RUN_BUILD == 'true' }
      }

      steps {
        sh 'npm run build'
      }
    }

    stage('Build Docker Image') {
      when {
        expression { env.RUN_DOCKER_BUILD == 'true' }
      }

      options {
        timeout(time: 15, unit: 'MINUTES')
      }

      steps {
        sh '''
          set -eu

          if command -v docker >/dev/null 2>&1; then
            docker build --progress=plain -t spritebot-ci .
          else
            echo 'Docker CLI not found on Jenkins agent; skipping local Docker smoke build.'
            echo 'The deploy stage still rebuilds the container on the remote Docker host.'
          fi
        '''
      }
    }

    stage('Package Deploy Archive') {
      when {
        expression { env.RUN_PACKAGE_DEPLOY == 'true' }
      }

      steps {
        sh '''
          set -eu

          archive_dir="$(mktemp -d)"
          trap 'rm -rf "$archive_dir"' EXIT

          tar \
            --exclude='.git' \
            --exclude='.env' \
            --exclude='.env.infisical' \
            --exclude='coverage' \
            --exclude='dist' \
            --exclude='node_modules' \
            --exclude="$DEPLOY_ARCHIVE" \
            -czf "$archive_dir/$DEPLOY_ARCHIVE" .

          cp "$archive_dir/$DEPLOY_ARCHIVE" "$DEPLOY_ARCHIVE"
        '''

        archiveArtifacts artifacts: "${env.DEPLOY_ARCHIVE}", fingerprint: true
      }
    }

    stage('Deploy') {
      when {
        expression { isDeployBranch() && env.RUN_PACKAGE_DEPLOY == 'true' }
      }

      steps {
        sshPublisher(
          publishers: [
            sshPublisherDesc(
              configName: "${env.DEPLOY_HOST}",
              transfers: [
                sshTransfer(
                  sourceFiles: "${env.DEPLOY_ARCHIVE}",
                  remoteDirectory: "${env.DEPLOY_REMOTE_DIR}",
                  execCommand: """
                    set -eu
                    cd ~/${env.DEPLOY_REMOTE_DIR}

                    if [ ! -f ${env.DEPLOY_ARCHIVE} ]; then
                      echo 'Missing deploy archive' >&2
                      exit 1
                    fi

                    if [ ! -f .env.infisical ]; then
                      echo 'Missing .env.infisical on remote host. Create it before deploying.' >&2
                      exit 1
                    fi

                    compose_bg() {
                      docker compose --profile bluegreen "\$@"
                    }

                    is_service_running() {
                      service="\$1"
                      container="\$(compose_bg ps -q "\$service" 2>/dev/null || true)"
                      if [ -z "\$container" ]; then
                        return 1
                      fi

                      running="\$(docker inspect -f '{{.State.Running}}' "\$container" 2>/dev/null || echo false)"
                      [ "\$running" = "true" ]
                    }

                    stop_service_with_logs() {
                      service="\$1"
                      echo "[deploy] Stopping old \$service container with 90s grace period..."
                      stop_started="\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                      compose_bg stop -t 90 "\$service"
                      stop_finished="\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                      echo "[deploy] Stop command completed. started=\$stop_started finished=\$stop_finished"

                      compose_bg logs --no-color --since 10m "\$service" > .deploy-shutdown.log 2>/dev/null || true
                      if [ -s .deploy-shutdown.log ]; then
                        echo '[deploy] Recent lifecycle shutdown log lines:'
                        grep -E '\\[lifecycle\\]|shutdown|drain|voice shutdown|database close' .deploy-shutdown.log | tail -80 || true

                        if grep -q '\\[lifecycle\\] database close' .deploy-shutdown.log; then
                          echo '[deploy] Observed graceful shutdown through database close.'
                        else
                          echo '[deploy] WARNING: did not observe database close in recent logs; shutdown may have timed out or logging may be incomplete.' >&2
                        fi
                      else
                        echo '[deploy] WARNING: no recent shutdown logs were available for the old container.' >&2
                      fi
                    }

                    current_service=''
                    running_services=''
                    running_count=0
                    for candidate in spritebot-blue spritebot-green spritebot; do
                      if is_service_running "\$candidate"; then
                        running_services="\$running_services \$candidate"
                        running_count=\$((running_count + 1))
                        current_service="\$candidate"
                      fi
                    done

                    if [ "\$running_count" -gt 1 ]; then
                      echo "[deploy] Multiple spritebot services are running:\$running_services" >&2
                      echo '[deploy] Refusing to guess the active slot. Stop the stale container manually and rerun deploy.' >&2
                      exit 1
                    fi

                    if [ "\$current_service" = "spritebot-blue" ]; then
                      target_service='spritebot-green'
                    else
                      target_service='spritebot-blue'
                    fi

                    if [ -n "\$current_service" ]; then
                      echo "[deploy] Current active container appears to be \$current_service."
                    else
                      echo '[deploy] No running spritebot container found; target slot will start directly.'
                    fi
                    echo "[deploy] Target standby slot: \$target_service"

                    if [ "\$current_service" = "spritebot" ]; then
                      echo '[deploy] Legacy spritebot service predates slot lease coordination; stopping it before starting the first blue/green slot.'
                      stop_service_with_logs "\$current_service"
                      compose_bg rm -f "\$current_service" >/dev/null 2>&1 || true
                      current_service=''
                    fi

                    find . -mindepth 1 -maxdepth 1 \
                      ! -name .env \
                      ! -name .env.infisical \
                      ! -name .env.previous \
                      ! -name ${env.DEPLOY_ARCHIVE} \
                      -exec rm -rf {} +

                    tar -xzf ${env.DEPLOY_ARCHIVE}
                    chmod +x entrypoint.sh
                    compose_bg config >/dev/null

                    echo "[deploy] Starting new \$target_service container in standby mode..."
                    promotion_started="\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                    compose_bg up -d --build --no-deps "\$target_service"

                    if [ -n "\$current_service" ]; then
                      stop_service_with_logs "\$current_service"
                      compose_bg rm -f "\$current_service" >/dev/null 2>&1 || true
                    fi

                    echo "[deploy] Waiting for \$target_service to acquire the runtime lease..."
                    acquired='false'
                    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
                      if compose_bg logs --no-color --since "\$promotion_started" "\$target_service" 2>/dev/null |
                        grep -Eq '\\[runtime-lease\\] acquired|Logged in as'; then
                        acquired='true'
                        break
                      fi
                      sleep 5
                    done

                    if [ "\$acquired" = "true" ]; then
                      echo "[deploy] \$target_service acquired the runtime lease and is active."
                    else
                      echo "[deploy] WARNING: did not observe \$target_service acquire the runtime lease within 60s." >&2
                    fi

                    compose_bg ps
                    echo "[deploy] Recent startup log lines for \$target_service:"
                    compose_bg logs --no-color --tail=120 "\$target_service" || true
                    rm -f ${env.DEPLOY_ARCHIVE}
                  """,
                  execTimeout: 600000,
                ),
              ],
              verbose: true,
            ),
          ],
        )
      }
    }
  }

  post {
    always {
      sh 'rm -f "$DEPLOY_ARCHIVE"'
    }
    success {
      script {
        notifyGithubStatus('success', "Jenkins ${env.CI_CHECK_PROFILE} checks completed")
      }
    }
    failure {
      script {
        notifyGithubStatus('failure', 'Jenkins build failed')
      }
    }
    unstable {
      script {
        notifyGithubStatus('failure', 'Jenkins build is unstable')
      }
    }
    aborted {
      script {
        notifyGithubStatus('error', 'Jenkins build was aborted')
      }
    }
  }
}
