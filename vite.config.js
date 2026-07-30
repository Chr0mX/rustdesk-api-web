import { defineConfig } from 'vite'
import * as path from 'path'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import vue from '@vitejs/plugin-vue'

const NODE_ENV = process.env.NODE_ENV || 'development'
const envFile = `.env.${NODE_ENV}`
const envConfig = dotenv.parse(fs.readFileSync(envFile))
for (const k in envConfig) {
  process.env[k] = envConfig[k]
}

let alias = {
  '@': path.resolve(__dirname, './src'),
  'vue$': 'vue/dist/vue.runtime.esm-bundler.js',
  // libsodium-wrappers' ESM build (dist/modules-esm/libsodium-wrappers.mjs)
  // has a real upstream packaging bug: it does `import e from "./libsodium.mjs"`,
  // a relative import that only resolves within its own package directory,
  // but that file is only ever published by the separate "libsodium"
  // package - so Vite/Rollup (correctly) can't find it and the build fails
  // with "Could not resolve './libsodium.mjs'". The CJS build
  // (dist/modules/libsodium-wrappers.js) doesn't have this bug - it
  // `require("libsodium")`s the whole package by name instead of a broken
  // relative path. Can't just alias to the package-relative specifier
  // "libsodium-wrappers/dist/modules/libsodium-wrappers.js" either, though
  // (tried that first, it fails too) - the package's package.json
  // "exports" map only declares the "." entry, no subpaths, so Node/Vite's
  // exports resolution rejects any deep import as an unlisted specifier
  // ("Missing ... specifier in libsodium-wrappers package"). Aliasing to
  // an actual resolved filesystem path instead sidesteps exports-map
  // resolution entirely, since Rollup treats an absolute path as already
  // resolved rather than a specifier to look up - confirmed by actually
  // downloading the real published libsodium-wrappers.js + libsodium.js,
  // require()-ing the former by this exact kind of path, and checking
  // sodium.ready resolves with the crypto functions globals.js needs
  // (crypto_secretbox_easy, crypto_box_keypair, crypto_sign_open, ...)
  // all present as real functions - not just reasoned from package
  // metadata.
  'libsodium-wrappers': path.resolve(__dirname, './node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'),
}

const conf = {
  base: './', // index.html文件所在位置
  root: './', // js导入的资源路径，src
  server: {
    open: true,
    port: process.env.VITE_DEV_PORT,
    proxy: {
      // More specific /api/admin entry first - Vite checks proxy keys in
      // insertion order, and /api/admin is a prefix match of /api below,
      // so the order here matters.
      [process.env.VITE_SERVER_API]: {
        target: process.env.VITE_SERVER_PATH,
        // rewrite: path => path.replace(/^\/api/, '/api'), //为了模拟
        changeOrigin: true,
      },
      // The webclient app (src/webclient) talks to the plain /api surface
      // instead of /api/admin - see src/webclient/utils/request.js.
      [process.env.VITE_WEBCLIENT_SERVER_API]: {
        target: process.env.VITE_SERVER_PATH,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild', // 是否进行压缩,boolean | 'terser' | 'esbuild',默认使用 esbuild
    manifest: false, // 是否产出maifest.json
    sourcemap: false, // 是否产出soucemap.json
    emptyOutDir: true,
    outDir: 'dist', // 产出目录
    rollupOptions: {
      // Multi-page build: index.html is _admin (unchanged), webclient.html
      // is the new Vue webclient shell (src/webclient) - see
      // docs/WEBCLIENT_V2_REBUILD_PLAN.md's Phase 4. Both build into the
      // same dist/ output; rustdesk-api's router only needs to serve
      // webclient.html (renamed to index.html) at whatever path the
      // webclient ends up mounted at - not done as part of this change,
      // see the plan doc's Phase 6 for the actual cutover.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        webclient: path.resolve(__dirname, 'webclient.html'),
      },
      output: {
        manualChunks (id) {
          if (id.includes('node_modules')) {
            const arr = id.toString().split('node_modules/')[1].split('/')
            switch (arr[0]) {
              case '@popperjs':
              case '@vue':
              case 'axios':
              case 'element-plus':
              case '@element-plus':
                return '_' + arr[0]
              default :
                return '__vendor'
            }
          }else if(id.includes('Gwen-admin/src')){
            //src 下的都打包到一起 不然很多小文件
            return 'gwen'
          }
        },
        chunkFileNames: 'static/chunk/[name]-[hash].js',
        entryFileNames: 'static/entry/[name]-[hash].js',
        assetFileNames: 'static/[ext]/[name]-[hash].[ext]'
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        javascriptEnabled: true,
      },
    },
  },
  resolve: {
    alias,
  },
  plugins: [
    vue(),
  ],
}

// https://vitejs.dev/config/
export default defineConfig(conf)
