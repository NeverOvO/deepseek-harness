module.exports = {
  packagerConfig: {
    asar: true,
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
