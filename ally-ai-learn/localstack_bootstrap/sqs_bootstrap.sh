#!/usr/bin/env bash

echo "Creating SQS queues..."

# Get queue name from environment variable or use default
QUEUE_NAME_RAW="${SQS_MESSAGE_EVENT_QUEUE_NAME:-message-event-queue}"

# Extract queue name if a full URL was provided
# URLs look like: http://host.docker.internal:4566/000000000000/queue-name
# or: http://localhost:4566/000000000000/queue-name
if [[ "${QUEUE_NAME_RAW}" =~ ^https?:// ]]; then
  # Extract the last part after the last slash
  QUEUE_NAME=$(basename "${QUEUE_NAME_RAW}")
else
  QUEUE_NAME="${QUEUE_NAME_RAW}"
fi

echo "Queue name: ${QUEUE_NAME}"

# Wait a bit for SQS service to be fully ready
sleep 2

# Check if queue already exists
QUEUE_CHECK=$(awslocal sqs get-queue-url --queue-name "${QUEUE_NAME}" 2>&1)
QUEUE_CHECK_EXIT=$?

if [ $QUEUE_CHECK_EXIT -eq 0 ]; then
  echo "Queue ${QUEUE_NAME} already exists, skipping creation"
else
  echo "Creating queue: ${QUEUE_NAME}"
  # Create the SQS queue
  CREATE_OUTPUT=$(awslocal sqs create-queue --queue-name "${QUEUE_NAME}" 2>&1)
  CREATE_EXIT=$?

  if [ $CREATE_EXIT -eq 0 ]; then
    echo "Successfully created queue: ${QUEUE_NAME}"
  else
    echo "Error creating queue ${QUEUE_NAME}: ${CREATE_OUTPUT}"
    exit 1
  fi
fi

echo "Queue ${QUEUE_NAME} is ready"
