declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SOLVER_URL?: string;
    SOLVER_TOKEN?: string;
  }
}
