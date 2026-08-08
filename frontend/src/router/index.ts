import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/materials',
      name: 'Materials',
      component: () => import('@/views/Materials.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/inventory',
      name: 'Inventory',
      component: () => import('@/views/Inventory.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/locations',
      name: 'Locations',
      component: () => import('@/views/Locations.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/orders',
      name: 'Orders',
      component: () => import('@/views/Orders.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/waves',
      name: 'Waves',
      component: () => import('@/views/Waves.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/work-orders',
      name: 'WorkOrders',
      component: () => import('@/views/WorkOrders.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/Settings.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// 全局前置守卫
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('access_token')
  if (to.meta.requiresAuth && !token) {
    next('/login')
  } else {
    next()
  }
})

export default router