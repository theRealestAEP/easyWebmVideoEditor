// Configuration file for environment variables
export const config = {
  get TENOR_API_KEY_FROM_ENV() {
    return process.env.TENOR_API_KEY;
  }
}; 