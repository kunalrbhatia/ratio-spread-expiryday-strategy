export interface SessionState {
  jwtToken: string | null;
  feedToken: string | null;
  refreshToken: string | null;
}

class SessionStore {
  private state: SessionState = {
    jwtToken: null,
    feedToken: null,
    refreshToken: null,
  };

  public setSession(jwtToken: string, feedToken: string, refreshToken: string) {
    this.state = { jwtToken, feedToken, refreshToken };
  }

  public getSession(): SessionState {
    return { ...this.state };
  }

  public clear() {
    this.state = {
      jwtToken: null,
      feedToken: null,
      refreshToken: null,
    };
  }
}

export const sessionStore = new SessionStore();
