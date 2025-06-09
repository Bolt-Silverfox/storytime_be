import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  async login(body: any): Promise<any> {
    // TODO: Implement login logic
    return { accessToken: 'jwt.token.here' };
  }

  async register(body: any): Promise<any> {
    // TODO: Implement registration logic
    return { message: 'User registered successfully' };
  }
}
