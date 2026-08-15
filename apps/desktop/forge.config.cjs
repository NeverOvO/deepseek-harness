module.exports = {
  packagerConfig: {
    // v0.1 keeps the bundled DSH runtime unpacked. The runtime is launched as
    // a child Node process and includes native dependencies; enabling ASAR is
    // deferred until packaged macOS verification proves the runtime and its
    // native modules can be relocated safely.
    asar: false,
    name: '八奈见工作台',
    executableName: 'Yanami Workbench',
    appBundleId: 'com.yunyulai.yanami-workbench',
    appCategoryType: 'public.app-category.developer-tools',
    extendInfo: {
      CFBundleDisplayName: '八奈见工作台',
      CFBundleName: 'Yanami Workbench'
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Yanami Workbench',
        format: 'ULFO'
      }
    }
  ]
}
