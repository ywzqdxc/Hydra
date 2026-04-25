package com.hydravision.service.device;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * K230 视频流接收服务
 */
@Slf4j
@Service
public class K230StreamService {

    private static final int SOCKET_PORT = 10000;
    private static final int SO_TIMEOUT_MS = 10000; // 设置 10 秒超时时间
    
    private volatile byte[] latestFrame = null; 
    private final Object frameLock = new Object();

    // 线程池用于处理具体的 Client 读取任务
    private final ExecutorService clientExecutor = Executors.newCachedThreadPool();
    private ServerSocket serverSocket;
    private Thread serverThread;
    private volatile boolean isRunning = true;

    @PostConstruct
    public void init() {
        serverThread = new Thread(this::startSocketServer);
        serverThread.setDaemon(true);
        serverThread.setName("K230-Accept-Thread");
        serverThread.start();
    }

    @PreDestroy
    public void destroy() {
        isRunning = false;
        try {
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
            clientExecutor.shutdownNow();
        } catch (IOException e) {
            log.error("关闭 Socket Server 异常", e);
        }
    }

    private void startSocketServer() {
        try {
            serverSocket = new ServerSocket(SOCKET_PORT);
            log.info("[*] 后台 Socket 服务启动，监听 {} 等待 K230 连接...", SOCKET_PORT);

            while (isRunning) {
                // 主线程只负责 accept，不负责 read
                Socket clientSocket = serverSocket.accept();
                log.info("[+] 硬件已连接! 地址: {}", clientSocket.getRemoteSocketAddress());
                
                // 将具体的读取任务扔进线程池处理
                clientExecutor.submit(() -> handleClient(clientSocket));
            }
        } catch (Exception e) {
            if (isRunning) {
                log.error("Socket Server 监听异常退", e);
            }
        }
    }

    /**
     * 处理单个 K230 客户端的连接
     */
    private void handleClient(Socket clientSocket) {
        // 1. 使用 try-with-resources 自动管理资源，保证 Socket 绝对会被关闭 (Java 9+ 语法)
        try (clientSocket;
             DataInputStream dis = new DataInputStream(clientSocket.getInputStream())) {
            
            // 2. 设置读取超时时间：如果设备 10 秒没有发任何数据，直接断开，防止半开连接死锁
            clientSocket.setSoTimeout(SO_TIMEOUT_MS);

            while (isRunning) {
                // 3. 读取 4 字节长度
                int dataLen = dis.readInt();
                if (dataLen <= 0 || dataLen > 10 * 1024 * 1024) { // 加一个防御性限制，比如单帧最大 10MB
                    log.warn("[-] 接收到异常的数据长度: {}，断开连接", dataLen);
                    break;
                }

                // 4. 接收完整 JPEG 图像数据
                byte[] imgData = new byte[dataLen];
                dis.readFully(imgData);

                // 5. 更新帧并唤醒 Web 线程
                latestFrame = imgData;
                synchronized (frameLock) {
                    frameLock.notifyAll();
                }
            }
        } catch (EOFException e) {
            log.info("[-] K230 正常断开连接 (EOF)");
        } catch (SocketTimeoutException e) {
            log.warn("[-] K230 连接超时 ({}ms 未收到数据)，强制断开", SO_TIMEOUT_MS);
        } catch (Exception e) {
            log.warn("[-] K230 连接异常断开: {}", e.getMessage());
        } finally {
            // 清理状态
            latestFrame = null; 
            log.info("[*] 释放当前连接资源完成。");
        }
    }

    public byte[] waitForNextFrame(long timeoutMs) {
        synchronized (frameLock) {
            try {
                frameLock.wait(timeoutMs); 
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return latestFrame;
    }

    public byte[] getLatestFrame() {
        return latestFrame;
    }
}