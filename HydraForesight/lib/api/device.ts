/**
 * 设备相关API
 */
import { apiClient, type ApiResponse, type PageResult } from "./request"

import { API_BASE_URL, TOKEN_KEY } from "./config"

export interface Device {
  id: number
  deviceId: string
  deviceName: string
  deviceType: number
  deviceModel?: string
  manufacturer?: string
  serialNumber?: string
  areaId: number
  locationName: string
  longitude: number
  latitude: number
  altitude?: number
  installDate?: string
  dataInterval?: number
  communicationType?: number
  powerType?: number
  status: number
  remark?: string
  createTime: string
}

export interface DeviceStatistics {
  totalCount: number
  onlineCount: number
  offlineCount: number
  warningCount: number
  maintenanceCount: number
  typeStatistics: Array<{ deviceType: number; count: number }>
  areaStatistics: Array<{ areaId: number; count: number }>
}

export interface DeviceQueryParams {
  deviceName?: string
  deviceId?: string
  deviceType?: number
  areaId?: number
  status?: number
  current?: number
  size?: number
}

export interface CreateDeviceRequest {
  deviceName: string
  deviceType: number
  deviceModel?: string
  manufacturer?: string
  areaId: number
  locationName: string
  longitude?: number
  latitude?: number
  altitude?: number
  installDate?: string
  dataInterval?: number
  communicationType?: number
  powerType?: number
  remark?: string
}

export interface UpdateDeviceRequest {
  id: number
  deviceName?: string
  deviceType?: number
  deviceModel?: string
  manufacturer?: string
  areaId?: number
  locationName?: string
  longitude?: number
  latitude?: number
  altitude?: number
  dataInterval?: number
  status?: number
  remark?: string
}

/**
 * 获取设备统计数据
 */
export async function getDeviceStatistics(): Promise<ApiResponse<DeviceStatistics>> {
  return apiClient.get<DeviceStatistics>("/device/statistics")
}

/**
 * 获取在线设备列表
 */
export async function getOnlineDevices(): Promise<ApiResponse<Device[]>> {
  return apiClient.get<Device[]>("/device/online")
}

/**
 * 分页查询设备
 */
export async function pageDevices(params: DeviceQueryParams): Promise<ApiResponse<PageResult<Device>>> {
  return apiClient.get<PageResult<Device>>("/device/page", params)
}

/**
 * 获取设备详情
 */
export async function getDeviceDetail(id: number): Promise<ApiResponse<Device>> {
  return apiClient.get<Device>(`/device/${id}`)
}

/**
 * 创建设备
 */
export async function createDevice(data: CreateDeviceRequest): Promise<ApiResponse<number>> {
  return apiClient.post<number>("/device", data)
}

/**
 * 更新设备
 */
export async function updateDevice(data: UpdateDeviceRequest): Promise<ApiResponse<void>> {
  return apiClient.put<void>("/device", data)
}

/**
 * 删除设备
 */
export async function deleteDevice(id: number): Promise<ApiResponse<void>> {
  return apiClient.delete<void>(`/device/${id}`)
}

/**
 * 更新设备状态
 */
export async function updateDeviceStatus(id: number, status: number): Promise<ApiResponse<void>> {
  return apiClient.put<void>(`/device/${id}/status/${status}`)
}

/**
 * 获取监控视频流 (由于是二进制流，不能使用默认拦截器里的 .json() 解析，因此单独封装原生 fetch)
 */
export async function fetchDeviceLiveStream(
  deviceId: number, 
  timestamp: number, 
  signal: AbortSignal
): Promise<Response> {
  const headers: HeadersInit = {}
  
  // 如果你的接口需要鉴权，和 request.ts 保持一致带上 token
  if (typeof window !== "undefined") {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }
  }

  // 拼接请求地址，注意和你的后端接口路径保持一致
  // 你的 request.ts 里普通请求是 `/device/${id}`，所以这里拼接 `/device/${deviceId}/live-image`
  const url = `${API_BASE_URL}/device/${deviceId}/live-image?t=${timestamp}`

  return fetch(url, {
    method: "GET",
    headers,
    signal, // 绑定中断信号
  })
}