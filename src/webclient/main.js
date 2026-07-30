import { createApp } from 'vue'
import 'element-plus/dist/index.css'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'normalize.css/normalize.css'
import { pinia } from '@/store'
import { router } from '@/webclient/router'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@/styles/style.scss'

const app = createApp(App)
app.use(ElementPlus)
app.use(pinia)
app.use(router)
app.mount('#webclient-app')
