FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY lib ./lib
COPY server ./server
COPY public/vendor/swmmwasm-0.0.4.js ./public/vendor/swmmwasm-0.0.4.js
RUN mkdir /data && chown node:node /data
USER node
ENV SOLVER_HOST=0.0.0.0 SOLVER_DATA_DIR=/data
EXPOSE 8788
CMD ["node", "--experimental-strip-types", "server/solver-service.mjs"]
