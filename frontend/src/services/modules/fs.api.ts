import type { ApiContext } from "./api-context";
import type { BrowseResult } from "./remote-workspace.api";

/**
 * 本机文件系统浏览 API（Web 模式目录选择器的数据源）。
 *
 * 返回形状与 remote-workspace 的 BrowseResult 一致，两套浏览器（远程连接向导 /
 * 本地目录选择对话框）共用同一套类型；区别只在后端——本接口读服务端本地磁盘。
 */
export interface FsApi {
  /** path 为空时由后端回退用户主目录 */
  browseLocalPath(path: string): Promise<BrowseResult>;
}

export const fsApi: FsApi = {
  async browseLocalPath(this: ApiContext, path: string) {
    return await this._request(`/fs/browse?path=${encodeURIComponent(path)}`);
  },
};
