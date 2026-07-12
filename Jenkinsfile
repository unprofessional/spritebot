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

                    find . -mindepth 1 -maxdepth 1 \
                      ! -name .env \
                      ! -name .env.infisical \
                      ! -name .env.previous \
                      ! -name ${env.DEPLOY_ARCHIVE} \
                      -exec rm -rf {} +

                    tar -xzf ${env.DEPLOY_ARCHIVE}
                    chmod +x entrypoint.sh
                    docker compose config >/dev/null
                    docker compose up -d --build --remove-orphans
                    docker compose ps
                    rm -f ${env.DEPLOY_ARCHIVE}
                  """,
                  execTimeout: 120000,
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
