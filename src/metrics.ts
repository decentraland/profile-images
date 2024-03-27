import { validateMetricsDeclaration } from '@well-known-components/metrics'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { IMetricsComponent } from '@well-known-components/interfaces'
import { getDefaultHttpMetrics } from '@well-known-components/http-server'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  snapshot_generation_duration_seconds: {
    help: 'Histogram of snapshot generation duration',
    type: IMetricsComponent.HistogramType,
    buckets: [0.1, 0.2, 0.5, 1, 2, 3, 4, 5, 6, 10]
  },
  snapshot_generation_count: {
    help: 'Count of snapshot generation',
    type: IMetricsComponent.CounterType,
    labelNames: ['status']
  },
  image_upload_duration_seconds: {
    help: 'Histogram of image upload duration',
    type: IMetricsComponent.HistogramType,
    labelNames: ['status']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
