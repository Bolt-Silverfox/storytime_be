import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

@ApiTags('Metrics')
@Controller('metrics')
@SkipThrottle() // Don't rate-limit metrics scraping
export class MetricsController {
    @Get()
    @ApiOperation({ summary: 'Prometheus metrics endpoint' })
    @ApiResponse({
        status: 200,
        description: 'Prometheus-formatted metrics',
        type: String,
    })
    async getMetrics(): Promise<string> {
        // Metrics are automatically exposed by PrometheusExporter on port 9464
        // This endpoint is just for documentation/health check purposes
        return 'Metrics are exposed on port 9464 at /metrics';
    }
}
