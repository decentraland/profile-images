import { getDefaultHttpMetrics, validateMetricsDeclaration } from '@well-known-components/metrics'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { IMetricsComponent } from '@well-known-components/interfaces'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  snapshot_generation_duration_seconds: {
    help: 'Histogram of snapshot generation duration',
    type: IMetricsComponent.HistogramType,
    labelNames: ['image', 'status']
  },
  image_upload_duration_seconds: {
    help: 'Histogram of image upload duration',
    type: IMetricsComponent.HistogramType,
    labelNames: ['status']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
