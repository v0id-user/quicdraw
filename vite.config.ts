import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      // `transport-io dev` publishes the certificate hash here.
      '/.well-known/transport-io-dev': 'http://127.0.0.1:4432',
    },
  },
})
