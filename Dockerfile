# Build a fully self-hosted static Mushaf reader.
FROM alpine:3.20 AS builder

WORKDIR /src
COPY . .

RUN apk add --no-cache bash coreutils gzip tar python3 \
    && chmod +x scripts/*.sh scripts/*.py \
    && ./scripts/build-static.sh /site

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /site /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1
