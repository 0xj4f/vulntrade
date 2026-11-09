{{/*
Fluent Bit sidecar that ships /var/log/vulntrade/{security,app}.log to S3 (off by default).
Every Java service pod includes it, so security events from all services reach the SIEM.
  containers: {{- include "vulntrade.logshipper.container" . | nindent 8 }}
  volumes:    {{- include "vulntrade.logshipper.volumes" . | nindent 8 }}
*/}}
{{- define "vulntrade.logshipper.container" -}}
{{- if .Values.logShipper.enabled }}
- name: log-shipper
  image: {{ .Values.logShipper.image }}
  env:
    - name: S3_BUCKET
      value: {{ .Values.logShipper.s3Bucket | quote }}
    - name: AWS_REGION
      value: {{ .Values.logShipper.awsRegion | quote }}
    - name: AWS_DEFAULT_REGION
      value: {{ .Values.logShipper.awsRegion | quote }}
    {{- range $key := list "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "AWS_SESSION_TOKEN" }}
    - name: {{ $key }}
      valueFrom: { secretKeyRef: { name: {{ include "vulntrade.secretName" $ }}, key: {{ $key }} } }
    {{- end }}
  volumeMounts:
    - name: logs
      mountPath: /var/log/vulntrade
      readOnly: true
    - name: log-shipper-config
      mountPath: /fluent-bit/etc/fluent-bit.conf
      subPath: fluent-bit.conf
    - name: log-shipper-config
      mountPath: /fluent-bit/etc/parsers.conf
      subPath: parsers.conf
    - name: fluent-bit-buffer
      mountPath: /var/log/fluent-bit
{{- end }}
{{- end -}}

{{- define "vulntrade.logshipper.volumes" -}}
{{- if .Values.logShipper.enabled }}
- name: log-shipper-config
  configMap:
    name: {{ .Release.Name }}-log-shipper
- name: fluent-bit-buffer
  emptyDir: {}
{{- end }}
{{- end -}}
