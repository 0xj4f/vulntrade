{{/* Chart name */}}
{{- define "vulntrade.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels */}}
{{- define "vulntrade.labels" -}}
app.kubernetes.io/name: {{ include "vulntrade.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: vulntrade
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Selector labels for one component: include "vulntrade.selector" (dict "ctx" . "component" "backend") */}}
{{- define "vulntrade.selector" -}}
app.kubernetes.io/name: {{ include "vulntrade.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* image reference: include "vulntrade.image" (dict "ctx" . "image" .Values.backend.image) */}}
{{- define "vulntrade.image" -}}
{{- printf "%s:%s" .image.repository (default .ctx.Chart.AppVersion .image.tag) -}}
{{- end -}}

{{/* Secret name */}}
{{- define "vulntrade.secretName" -}}
{{- printf "%s-secrets" .Release.Name -}}
{{- end -}}
