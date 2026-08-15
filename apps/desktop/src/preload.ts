import { contextBridge } from 'electron'

export interface YanamiDesktopBridge {
  readonly isDesktop: true
  readonly platform: NodeJS.Platform
}

contextBridge.exposeInMainWorld('yanamiDesktop', {
  isDesktop: true,
  platform: process.platform,
} satisfies YanamiDesktopBridge)
