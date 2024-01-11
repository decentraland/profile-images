import { getDefaultHttpMetrics, validateMetricsDeclaration } from '@well-known-components/metrics'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { IMetricsComponent } from '@well-known-components/interfaces'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  snapshot_generation_duration_seconds: {
    help: 'Histogram of snapshot generation duration',
    type: IMetricsComponent.HistogramType,
    labelNames: ['profiles', 'status'],
    buckets: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000]
  },
  image_upload_duration_seconds: {
    help: 'Histogram of image upload duration',
    type: IMetricsComponent.HistogramType,
    labelNames: ['status']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
