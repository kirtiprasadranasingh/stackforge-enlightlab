package com.example.health;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class Application {
    private static void respond(HttpExchange exchange, int status) throws IOException {
        byte[] body = "{\"status\":\"ok\"}".getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    private static void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        respond(exchange, ("/".equals(path) || "/health".equals(path)) ? 200 : 404);
    }

    private static int port() {
        String raw = System.getenv().getOrDefault("PORT", "8080");
        try {
            int value = Integer.parseInt(raw);
            if (value >= 1 && value <= 65535) return value;
        } catch (NumberFormatException ignored) {
            // Use the safe container default below.
        }
        System.err.println("Invalid PORT value '" + raw + "'; using 8080");
        return 8080;
    }

    public static void main(String[] args) throws IOException {
        int port = port();
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", Application::handle);
        server.start();
        System.out.println("Health service listening on " + port);
    }
}
