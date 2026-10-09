import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  if (command === 'build') {
    const apiUrl = process.env.VITE_API_URL?.trim()
    if (!apiUrl) {
      throw new Error('VITE_API_URL must be set to the deployed HTTPS API origin before building for production.')
    }

    let apiOrigin
    try {
      apiOrigin = new URL(apiUrl)
    } catch {
      throw new Error('VITE_API_URL must be a valid HTTPS API origin, for example https://your-api.onrender.com.')
    }

    if (apiOrigin.protocol !== 'https:' || apiOrigin.pathname !== '/' || apiOrigin.search || apiOrigin.hash) {
      throw new Error('VITE_API_URL must be an HTTPS origin without a path, query, or fragment.')
    }
  }

  return {
    plugins: [react()],
  }
})
