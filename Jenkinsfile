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

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Lint') {
      steps {
        sh 'npm run lint'
      }
    }

    stage('Test') {
      steps {
        sh 'npm test -- --runInBand'
      }
    }

    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }

    stage('Build Docker Image') {
      options {
        timeout(time: 15, unit: 'MINUTES')
      }

      steps {
        sh 'docker build --progress=plain -t spritebot-ci .'
      }
    }

    stage('Package Deploy Archive') {
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
        expression { isDeployBranch() }
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
        notifyGithubStatus('success', 'Jenkins build completed successfully')
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
