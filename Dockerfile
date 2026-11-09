# Debian (glibc) base on purpose: @snazzah/davey ships a linux-x64-gnu prebuilt,
# and ffmpeg-static downloads its Linux binary during `npm ci`. Never copy a
# node_modules built on macOS into this image.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ffmpeg-static's Linux build segfaults on any hostname lookup, which kills
# every http(s) track. prism-media always tries ffmpeg-static first, so swap
# the binary in place rather than just installing a second ffmpeg.
RUN ln -sf /usr/bin/ffmpeg node_modules/ffmpeg-static/ffmpeg

COPY . .
# data/ holds mailbox.json; mounted as a volume, owned by the unprivileged user.
RUN mkdir -p data && chown -R node:node data

USER node
CMD ["node", "index.js"]
