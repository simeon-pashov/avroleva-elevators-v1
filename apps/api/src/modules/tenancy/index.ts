/**
 * tenancy (L1) - public interface. Owns: tenant, user, session, platform_admin.
 * Other modules import ONLY from this file (ARCHITECTURE section 1.1).
 */
export { authenticate } from './http/auth.middleware.js'
export {
  authRouter,
  tenantRouter,
  usersRouter,
  sessionCookieOptions,
  clearCookie,
  loginLimiter,
} from './http/router.js'
export {
  login,
  logout,
  me,
  getTenant,
  getTenantSettings,
  updateTenant,
  listUsers,
  createUser,
  updateUser,
  setUserPassword,
  adminLogin,
  ensurePlatformAdmin,
  registerTenant,
  adminListTenants,
  adminGetTenant,
  adminUpdateTenant,
  adminResetUserPassword,
} from './service.js'
export { hashPassword, verifyPassword } from './domain/password.js'
