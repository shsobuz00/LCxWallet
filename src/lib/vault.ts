/** Admin Main Treasury wallet: receives every forwarded deposit and pays every withdrawal. Public address, set in .env. */
export const ADMIN_MAIN_VAULT = import.meta.env.VITE_ADMIN_MAIN_VAULT as `0x${string}` | undefined
