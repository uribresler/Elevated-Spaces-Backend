declare module "passport-apple" {
  import { Strategy as PassportStrategy } from "passport";

  interface AppleStrategyOptions {
    clientID: string;
    teamID: string;
    keyID: string;
    privateKeyString?: string;
    privateKeyLocation?: string;
    callbackURL: string;
    scope?: string[];
    passReqToCallback?: boolean;
  }

  type AppleVerifyCallback = (
    accessToken: string,
    refreshToken: string,
    idToken: any,
    profile: any,
    done: (error: any, user?: any) => void
  ) => void;

  class Strategy extends PassportStrategy {
    constructor(options: AppleStrategyOptions, verify: AppleVerifyCallback);
    name: string;
  }

  export default Strategy;
}
