FROM golang:1.23 AS builder

WORKDIR /app

COPY go.mod ./
COPY cmd ./cmd

ARG SERVICE_PATH

RUN test -n "$SERVICE_PATH"
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/service "$SERVICE_PATH"

FROM gcr.io/distroless/static-debian12

WORKDIR /app

COPY --from=builder /out/service /app/service

EXPOSE 8080

ENTRYPOINT ["/app/service"]
