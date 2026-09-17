terraform {
  required_version = ">= 1.7"

  required_providers {
    fly = {
      source  = "fly-apps/fly"
      version = "~> 0.0.23"
    }
  }
}

variable "fly_api_token" {
  type      = string
  sensitive = true
}

variable "app_name" {
  type    = string
  default = "quicdraw"
}

variable "org" {
  type    = string
  default = "personal"
}

provider "fly" {
  fly_api_token = var.fly_api_token
}

resource "fly_app" "quicdraw" {
  name = var.app_name
  org  = var.org
}

# UDP, and so WebTransport, only reaches an app through a dedicated IPv4.
resource "fly_ip" "v4" {
  app  = fly_app.quicdraw.name
  type = "v4"
}

# Free, and serves the page over TCP.
resource "fly_ip" "v6" {
  app  = fly_app.quicdraw.name
  type = "v6"
}

output "ipv4" {
  value = fly_ip.v4.address
}
