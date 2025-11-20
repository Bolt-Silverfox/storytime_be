import { Injectable } from '@nestjs/common';
import IHealth, { HealthResponse } from './Ihealth.interfaces';
//
@Injectable()
class HealthCheck {
  static HealthServices: IHealth[] = [];

  public async CheckHealth(): Promise<HealthResponse[]> {
    const healthChecks = await Promise.all(
      HealthCheck.HealthServices.map((service) => service.CheckHealth()),
    );

    return healthChecks;
  }

  add = (service: IHealth) => {
    HealthCheck.HealthServices.push(service);
  };
}

export default HealthCheck;
