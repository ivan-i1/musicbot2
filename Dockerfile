# Debian (glibc) base on purpose: @snazzah/davey ships a linux-x64-gnu prebuilt,
# and ffmpeg-static downloads its Linux binary during `npm ci`. Never copy a
# node_modules built on macOS into this image.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
# data/ holds mailbox.json; mounted as a volume, owned by the unprivileged user.
RUN mkdir -p data && chown -R node:node data

USER node
CMD ["node", "index.js"]
