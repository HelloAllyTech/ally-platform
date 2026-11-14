FROM node:24-alpine

WORKDIR /app

RUN mkdir -p /tmp/audio_storage

RUN mkdir -p /mnt/audio_storage

RUN apk add --no-cache ffmpeg

COPY package*.json ./

RUN npm install

COPY . .

# nest build (with its compiler plugins) outgrew Node's default heap on 2026-11-11.
# Scoped to this step: the running container keeps its own heap settings.
RUN NODE_OPTIONS=--max-old-space-size=6144 npm run build

EXPOSE 8000

CMD ["npm", "run", "start:prod"]
