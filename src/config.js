// Configuration file for environment variables
export const config = {
  // Get Tenor API Key from environment variable
  // Note: React requires environment variables to be available at build time
  get TENOR_API_KEY_FROM_ENV() {
    return process.env.TENOR_API_KEY;
  }
}; 