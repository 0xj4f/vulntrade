# VulnTrade on local Kubernetes (minikube or OrbStack). Run from this directory: make <target>
# docker compose (repo root) stays the quickest way to run the lab; this is the k8s path.

KUBE_CONTEXT     ?= minikube
NAMESPACE        ?= vulntrade
RELEASE          ?= vulntrade
MINIKUBE_PROFILE ?= minikube
IMAGE_TAG        ?= local
BUILD_CONTEXT    ?= ..
CHART            := helm/vulntrade
VALUES           ?= $(CHART)/values-minikube.yaml
# Extra values file(s), e.g. EXTRA_VALUES="-f $(CHART)/values-nodeport.yaml"
EXTRA_VALUES     ?=
FRONTEND_PORT    ?= 3001
BACKEND_PORT     ?= 8085
ADMINER_PORT     ?= 8081
ORBSTACK_DOCKER_HOST ?= unix://$(HOME)/.orbstack/run/docker.sock
# Contexts this Makefile will touch. VulnTrade is intentionally vulnerable — never let a typo
# deploy it to a shared or cloud cluster. Override with ALLOWED_CONTEXTS="..." if you must.
ALLOWED_CONTEXTS ?= minikube vulntrade-arch orbstack docker-desktop kind-vulntrade

KUBECTL := kubectl --context $(KUBE_CONTEXT) -n $(NAMESPACE)
HELM    := helm --kube-context $(KUBE_CONTEXT) -n $(NAMESPACE)

.PHONY: help check-context build minikube-load minikube-up orbstack-build orbstack-up install \
        uninstall reset status port-forward logs lint template

help:
	@echo "make minikube-up    build images, load them into minikube, install the chart"
	@echo "make orbstack-up    build images on OrbStack's engine, install into OrbStack k8s"
	@echo "make port-forward   frontend :$(FRONTEND_PORT), backend :$(BACKEND_PORT), adminer :$(ADMINER_PORT)"
	@echo "make status | logs | uninstall | reset | lint | template"

check-context:
	@case " $(ALLOWED_CONTEXTS) " in *" $(KUBE_CONTEXT) "*) ;; \
	  *) echo "Refusing to use kube context '$(KUBE_CONTEXT)' (allowed: $(ALLOWED_CONTEXTS))"; exit 1;; esac
	@kubectl config get-contexts -o name | grep -qx "$(KUBE_CONTEXT)" || \
	  { echo "kube context '$(KUBE_CONTEXT)' not found in your kubeconfig"; exit 1; }

## Images ------------------------------------------------------------------
build:
	docker build -t vulntrade-backend:$(IMAGE_TAG) $(BUILD_CONTEXT)/backend
	docker build -t vulntrade-frontend:$(IMAGE_TAG) $(BUILD_CONTEXT)/frontend

minikube-load:
	minikube -p $(MINIKUBE_PROFILE) image load vulntrade-backend:$(IMAGE_TAG)
	minikube -p $(MINIKUBE_PROFILE) image load vulntrade-frontend:$(IMAGE_TAG)

# OrbStack's Kubernetes runs on OrbStack's Docker engine: build there and the cluster sees it.
# DOCKER_HOST is set explicitly because a global DOCKER_HOST overrides `docker --context`.
orbstack-build:
	DOCKER_HOST=$(ORBSTACK_DOCKER_HOST) docker build -t vulntrade-backend:$(IMAGE_TAG) $(BUILD_CONTEXT)/backend
	DOCKER_HOST=$(ORBSTACK_DOCKER_HOST) docker build -t vulntrade-frontend:$(IMAGE_TAG) $(BUILD_CONTEXT)/frontend

## Deploy ------------------------------------------------------------------
install: check-context
	$(HELM) upgrade --install $(RELEASE) $(CHART) --create-namespace -f $(VALUES) $(EXTRA_VALUES) \
	  --set backend.image.tag=$(IMAGE_TAG) --set frontend.image.tag=$(IMAGE_TAG) \
	  --wait --timeout 12m

minikube-up: build minikube-load
	$(MAKE) install KUBE_CONTEXT=$(MINIKUBE_PROFILE) VALUES=$(CHART)/values-minikube.yaml

orbstack-up: orbstack-build
	$(MAKE) install KUBE_CONTEXT=orbstack VALUES=$(CHART)/values-orbstack.yaml

uninstall: check-context
	$(HELM) uninstall $(RELEASE)

# Uninstall and drop the data volumes (fresh database and seed on the next install).
reset: check-context
	-$(HELM) uninstall $(RELEASE)
	$(KUBECTL) delete pvc -l app.kubernetes.io/instance=$(RELEASE) --ignore-not-found
	$(KUBECTL) delete pvc -l app.kubernetes.io/component=postgres --ignore-not-found

## Use ---------------------------------------------------------------------
status: check-context
	$(KUBECTL) get pods,svc,pvc

port-forward: check-context
	@echo "frontend http://localhost:$(FRONTEND_PORT)  backend http://localhost:$(BACKEND_PORT)  adminer http://localhost:$(ADMINER_PORT)  (Ctrl-C to stop)"
	@trap 'kill 0' INT TERM; \
	  $(KUBECTL) port-forward svc/frontend $(FRONTEND_PORT):80 & \
	  $(KUBECTL) port-forward svc/backend $(BACKEND_PORT):8080 & \
	  $(KUBECTL) port-forward svc/adminer $(ADMINER_PORT):8080 & \
	  wait

logs: check-context
	$(KUBECTL) logs deploy/backend -f --tail=200

lint:
	helm lint $(CHART) -f $(CHART)/values-minikube.yaml
	helm lint $(CHART) -f $(CHART)/values-orbstack.yaml

template:
	helm template $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(VALUES)
