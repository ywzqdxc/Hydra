package com.hydravision.controller.device;

import com.hydravision.common.result.PageResult;
import com.hydravision.common.result.Result;
import com.hydravision.dto.device.DeviceCreateDTO;
import com.hydravision.dto.device.DeviceQueryDTO;
import com.hydravision.dto.device.DeviceUpdateDTO;
import com.hydravision.service.device.DeviceService;
import com.hydravision.service.device.K230StreamService;
import com.hydravision.vo.device.DeviceStatisticsVO;
import com.hydravision.vo.device.DeviceVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.OutputStream;
import java.util.List;

/**
 * 设备管理控制器
 */
@Tag(name = "设备管理", description = "设备相关接口")
@RestController
@RequestMapping("/device")
@RequiredArgsConstructor
public class DeviceController {

    private final DeviceService deviceService;
    private final K230StreamService k230StreamService;

    @Operation(summary = "创建设备")
    @PostMapping
    public Result<Long> createDevice(@Valid @RequestBody DeviceCreateDTO dto) {
        return Result.success(deviceService.createDevice(dto));
    }

    @Operation(summary = "更新设备")
    @PutMapping
    public Result<Void> updateDevice(@Valid @RequestBody DeviceUpdateDTO dto) {
        deviceService.updateDevice(dto);
        return Result.success();
    }

    @Operation(summary = "删除设备")
    @DeleteMapping("/{id}")
    public Result<Void> deleteDevice(@Parameter(description = "设备ID") @PathVariable Long id) {
        deviceService.deleteDevice(id);
        return Result.success();
    }

    @Operation(summary = "获取设备详情")
    @GetMapping("/{id}")
    public Result<DeviceVO> getDeviceDetail(@Parameter(description = "设备ID") @PathVariable Long id) {
        return Result.success(deviceService.getDeviceDetail(id));
    }

    @Operation(summary = "分页查询设备")
    @GetMapping("/page")
    public Result<PageResult<DeviceVO>> pageDevices(DeviceQueryDTO query) {
        return Result.success(deviceService.pageDevices(query));
    }

    @Operation(summary = "获取设备统计")
    @GetMapping("/statistics")
    public Result<DeviceStatisticsVO> getStatistics() {
        return Result.success(deviceService.getStatistics());
    }

    @Operation(summary = "获取在线设备列表")
    @GetMapping("/online")
    public Result<List<DeviceVO>> getOnlineDevices() {
        return Result.success(deviceService.getOnlineDevices());
    }

    @Operation(summary = "更新设备状态")
    @PutMapping("/{id}/status/{status}")
    public Result<Void> updateDeviceStatus(
            @Parameter(description = "设备ID") @PathVariable Long id,
            @Parameter(description = "状态") @PathVariable Integer status) {
        deviceService.updateDeviceStatus(id, status);
        return Result.success();
    }

    @Operation(summary = "获取设备实时视频流 (MJPEG)")
    @GetMapping("/{id}/live-image")
    public void getLiveImage(
            @Parameter(description = "设备ID(暂不作区分)") @PathVariable Long id,
            HttpServletResponse response) {

        // 如果当前没有最新帧（K230没连接或断开了）
        if (k230StreamService.getLatestFrame() == null) {
            response.setStatus(503);
            response.setContentType("image/jpeg");
            return; // 返回伪装的空响应，避免报错
        }

        // 设置 MJPEG HTTP Header 
        response.setContentType("multipart/x-mixed-replace; boundary=frame");
        // Spring Boot 解决跨域可以使用全局 @CrossOrigin 配置，这里仅补充防缓存
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        response.setHeader("Connection", "keep-alive");

        try (OutputStream os = response.getOutputStream()) {
            while (true) {
                // 等待下一张图片，超时时间3秒（与 Python 保持一致）
                byte[] frame = k230StreamService.waitForNextFrame(3000);
                
                if (frame == null) {
                    break; // 超时或者设备断开，停止流传输
                }

                // 按照 HTTP Multipart MJPEG 协议组装数据
                os.write(("--frame\r\n").getBytes());
                os.write(("Content-Type: image/jpeg\r\n\r\n").getBytes());
                os.write(frame);
                os.write(("\r\n").getBytes());
                os.flush(); // 强制发送给浏览器
            }
        } catch (IOException e) {
            // 浏览器关闭网页或刷新时会导致客户端主动断开抛出异常，这是正常现象，静默处理即可
            // log.debug("前端已停止访问视频流");
        }
    }
}
