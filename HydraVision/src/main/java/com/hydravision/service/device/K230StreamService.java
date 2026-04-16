package com.hydravision.service.device;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.DataInputStream;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * K230 视频流接收服务
 */
@Slf4j
@Service
public class K230StreamService {

    private static final int SOCKET_PORT = 10000;
    
    // volatile 保证多线程可见性，等同于 Python 的 global latest_frame
    private volatile byte[] latestFrame = null; 
    
    // 等同于 Python 的 threading.Condition()
    private final Object frameLock = new Object();

    @PostConstruct
    public void init() {
        // 启动后台守护线程监听 Socket
        Thread serverThread = new Thread(this::startSocketServer);
        serverThread.setDaemon(true);
        serverThread.setName("K230-Socket-Server");
        serverThread.start();
    }

    private void startSocketServer() {
        try (ServerSocket serverSocket = new ServerSocket(SOCKET_PORT)) {
            log.info("[*] 后台 Socket 服务启动，监听 {} 等待 K230 连接...", SOCKET_PORT);

            while (true) {
                try {
                    Socket clientSocket = serverSocket.accept();
                    log.info("[+] 硬件已连接! 地址: {}", clientSocket.getRemoteSocketAddress());

                    // 使用 DataInputStream 方便读取 4字节整型 (默认大端，与 Python struct.unpack('>I') 一致)
                    DataInputStream dis = new DataInputStream(clientSocket.getInputStream());

                    while (true) {
                        // 1. 接收 4 字节数据头
                        int dataLen = dis.readInt();
                        if (dataLen <= 0) break;

                        // 2. 接收完整 JPEG 图像数据
                        byte[] imgData = new byte[dataLen];
                        dis.readFully(imgData); // 等同于 Python 的 recvall

                        // 3. 将新帧存入全局变量，并唤醒所有等待的 Web 线程
                        latestFrame = imgData;
                        synchronized (frameLock) {
                            frameLock.notifyAll();
                        }
                    }
                } catch (Exception e) {
                    log.warn("[-] K230 连接断开，等待重新连接... 原因: {}", e.getMessage());
                    latestFrame = null;
                }
            }
        } catch (Exception e) {
            log.error("Socket Server 启动失败", e);
        }
    }

    /**
     * 阻塞等待下一帧图像数据
     * @param timeoutMs 超时时间(毫秒)
     * @return 图像字节数组，超时或无数据返回 null
     */
    public byte[] waitForNextFrame(long timeoutMs) {
        synchronized (frameLock) {
            try {
                // 阻塞等待被唤醒（有新图片），或超时
                frameLock.wait(timeoutMs); 
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return latestFrame;
    }

    /**
     * 获取当前最新帧（不等待）
     */
    public byte[] getLatestFrame() {
        return latestFrame;
    }
}