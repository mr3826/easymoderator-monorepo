# EasyMod Backend - Terraform Infrastructure

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~5.0"
    }
  }

  provider "google" {
    project = var.gcp_project_id
    region  = var.gcp_region
  zone    = var.gcp_zone
  }

  # Variables
  variable "gcp_project_id" {
    description = "GCP Project ID"
    type        = string
    default     = "gen-lang-client-0405487706"
  }

  variable "gcp_region" {
    description = "GCP Region"
    type        = string
    default     = "us-central1"
  }

  variable "gcp_zone" {
    description = "GCP Zone"
    type        = string
    default     = "us-central1-a"
  }

  variable "environment" {
    description = "Environment (staging/production)"
    type        = string
    default     = "production"
  }

  variable "domain_name" {
    description = "Application domain name"
    type        = string
    default     = "easymod.tech"
  }

  # VPC Configuration
  resource "google_compute_network" "vpc" {
    name    = "${var.environment}-vpc"
    auto_create_subnetworks = false
    routing_mode = "REGIONAL"
  }

  resource "google_compute_subnetwork" "subnet" {
    name          = "${var.environment}-subnet"
    ip_cidr_range = "10.0.0.0/16"
    region        = var.gcp_region
    network       = google_compute_network.vpc.id
    private_ip_google_access = true
  }

  # Cloud Run Configuration
  resource "google_cloud_run_service" "backend" {
    for_each = var.environments
    name     = "${each.key}-backend"
    location  = var.gcp_region
    
    template {
      spec {
        containers {
          image = "us-central1-docker.pkg.dev/${var.gcp_project_id}/easymod-backend/app:latest"
          ports {
            containers {
              name = "http1"
              container_port = 3000
            }
          }
          
          resources {
            limits = {
              cpu    = "1"
              memory = "1Gi"
            }
            
            requests = {
              cpu    = "250m"
              memory = "512Mi"
            }
          }
          
          env = [
            {
              name  = "NODE_ENV"
              value = "${each.key}"
            },
            {
              name  = "GCP_PROJECT_ID"
              value = var.gcp_project_id
            },
            {
              name  = "GCP_SECRET_PREFIX"
              value = "easymod-${each.key}"
            },
            {
              name  = "DATABASE_URL"
              value = var.database_url
            },
            {
              name  = "REDIS_URL"
              value = var.redis_url
            },
            {
              name  = "CORS_ORIGINS"
              value = "https://${var.domain_name},https://www.${var.domain_name}"
            },
            {
              name  = "FRONTEND_URL"
              value = "https://${var.domain_name}"
            },
            {
              name  = "PORT"
              value = "3000"
            }
          ]
        }
        
        traffic {
          percent = 100
        }
        
        timeout_seconds = 300
        
        # VPC Connector for private networking
        vpc_access {
          connector = "projects/${var.gcp_project_id}/locations/${var.gcp_region}/connectors/easymod-${each.key}-connector"
          egress = "ALL_TRAFFIC"
        }
      }
      
      metadata {
        annotations = {
          "run.googleapis.com/ingress" = "all"
          "run.googleapis.com/launch-stage" = "production-ready"
        }
      }
    
    depends_on = [
      google_compute_network.vpc,
      google_compute_subnetwork.subnet,
      google_vpc_access_connector.vpc_connector
    ]
  }

  # VPC Connectors for each environment
  resource "google_vpc_access_connector" "vpc_connector" {
    for_each = var.environments
    name     = "easymod-${each.key}-connector"
    region    = var.gcp_region
    
    ip_cidr_range = "10.132.0.0/28"
    network    = google_compute_network.vpc.id
    
    max_throughput = 1000
    min_throughput = 100
  }

  # Cloud Storage for backups
  resource "google_storage_bucket" "backups" {
    name     = "easymod-backups"
    location  = var.gcp_region
    
    lifecycle_rule {
      condition {
        age = 30
      }
      action {
        type = "Delete"
      }
    }
  }

  # Cloud SQL for staging database
  resource "google_sql_database_instance" "staging_db" {
    count    = var.environment == "staging" ? 1 : 0
    
    name             = "easymod-staging-db"
    database_version = "POSTGRES_15"
    region           = var.gcp_region
    
    settings {
      tier = "db-custom-4-3840"
      disk_size = 20
      disk_type = "PD_SSD"
      backup_configuration {
        enabled = true
        start_time = "03:00"
        location = "us-central1"
      }
    }
    
    deletion_protection = true
  }

  # Redis (Memorystore) for staging
  resource "google_redis_instance" "staging_redis" {
    count    = var.environment == "staging" ? 1 : 0
    
    name           = "easymod-staging-redis"
    region         = var.gcp_region
    tier           = "STANDARD_1"
    memory_size_gb = 4
    
    redis_version = "REDIS_7_0"
  }

  # Secret Manager Configuration
  resource "google_secret_manager_secret" "secrets" {
    for_each = var.secrets
    
    secret_id = "${each.key}-secret"
    
    replication {
      automatic = true
    locations = ["us-central1"]
    }
    
    depends_on = [
      google_secret_manager_secret_version.secrets_version
    ]
  }

  resource "google_secret_manager_secret_version" "secrets_version" {
    for_each = var.secrets
    secret   = google_secret_manager_secret.secrets[each.key].id
    version  = 1
    
    data = {
      payload = jsonencode(var.secret_values[each.key])
    }
  }

  # Local variables file generation
  locals {
    environments = ["staging", "production"]
    
    secret_keys = [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET", 
      "SESSION_SECRET",
      "CSRF_SECRET",
      "PAYMENT_ENCRYPTION_KEY",
      "CHANNEL_ENCRYPTION_KEY",
      "META_WEBHOOK_APP_SECRET"
    ]
    
    secret_values = {
      for key in local.secret_keys : {
        "${key}" = "${replace(google_secret_manager_secret.secrets_version[key].data["payload"], "\"", "\\\"")}"
      }
    }
  }

  # Variables
  variable "environments" {
    description = "List of environments to deploy"
    type        = list(string)
    default     = ["staging", "production"]
  }

  variable "secrets" {
    description = "List of secrets to manage"
    type        = list(string)
    default     = [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "SESSION_SECRET", 
      "CSRF_SECRET",
      "PAYMENT_ENCRYPTION_KEY",
      "CHANNEL_ENCRYPTION_KEY",
      "META_WEBHOOK_APP_SECRET"
    ]
  }

  variable "database_url" {
    description = "Database connection URL"
    type        = string
    sensitive   = true
  }

  variable "redis_url" {
    description = "Redis connection URL"
    type        = string
    sensitive   = true
  }

  variable "domain_name" {
    description = "Application domain name"
    type        = string
    default     = "easymod.tech"
  }

  # Output values
  output "service_urls" {
    description = "Cloud Run service URLs"
    value = {
      for env in google_cloud_run_service.backend : {
        "${env}" = google_cloud_run_service.backend[env].status[0].url
      }
    }
  }

  output "secret_manager_urls" {
    description = "Secret Manager access URLs"
    value = {
      for key in local.secret_keys : {
        "${key}" = "https://console.cloud.google.com/security/secret-manager/secret/${key}/versions?project=${var.gcp_project_id}"
      }
    }
  }

  output "backup_bucket_url" {
    description = "Cloud Storage bucket URL"
    value = "https://console.cloud.google.com/storage/browser/easymod-backups?project=${var.gcp_project_id}"
  }
