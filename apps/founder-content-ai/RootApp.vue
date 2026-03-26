<script setup lang="ts">
import App from "./App.vue";
import ProductAccessProvider from "./access/ProductAccessProvider.vue";
import AuthProvider from "./auth/AuthProvider.vue";
import ThemeProvider from "./preferences/ThemeProvider.vue";
</script>

<template>
  <AuthProvider>
    <ProductAccessProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ProductAccessProvider>
  </AuthProvider>
</template>
