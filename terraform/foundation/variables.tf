variable "aws_region" {
  type        = string
  description = "AWS region for the foundation resources."
}

variable "name" {
  type        = string
  description = "Base name for tagged resources."
  default     = "go-links"
}

variable "domains" {
  type        = list(string)
  description = "Provisioned host list used for certificates, hosted zones, and DOMAINS_JSON."

  validation {
    condition     = length(var.domains) > 0 && alltrue([for host in var.domains : length(trimspace(host)) > 0])
    error_message = "domains must contain at least one non-empty host."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC."
  default     = "10.42.0.0/16"
}

variable "database_name" {
  type        = string
  description = "Database name for Aurora."
  default     = "go_links"
}

variable "database_username" {
  type        = string
  description = "Master username stored in Secrets Manager and used by the proxy."
  default     = "go_links_app"
}

variable "email_auth_from_email" {
  type        = string
  description = "Optional SES-backed From address for email-code sign-in, for example no-reply@example.com."
  default     = ""

  validation {
    condition = (
      trimspace(var.email_auth_from_email) == "" ||
      can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", trimspace(var.email_auth_from_email)))
    )
    error_message = "email_auth_from_email must be empty or a valid email address."
  }
}

variable "email_auth_from_name" {
  type        = string
  description = "Optional display name for SES-backed email-code sign-in emails."
  default     = "Brick Golf Links"
}

variable "email_auth_hosted_zone_domain" {
  type        = string
  description = "Route53 hosted zone domain that should receive SES verification, DKIM, and MAIL FROM records for email-code sign-in."
  default     = ""

  validation {
    condition = (
      trimspace(var.email_auth_from_email) == "" ||
      (
        length(trimspace(var.email_auth_hosted_zone_domain)) > 0 &&
        can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", trimspace(var.email_auth_from_email))) &&
        (
          split("@", lower(trimspace(var.email_auth_from_email)))[1] == lower(trimspace(var.email_auth_hosted_zone_domain)) ||
          endswith(
            split("@", lower(trimspace(var.email_auth_from_email)))[1],
            ".${lower(trimspace(var.email_auth_hosted_zone_domain))}"
          )
        )
      )
    )
    error_message = "email_auth_hosted_zone_domain must be set to a parent Route53 zone for email_auth_from_email when SES email auth is enabled."
  }
}

variable "email_auth_mail_from_subdomain" {
  type        = string
  description = "Subdomain prefix to use for the SES custom MAIL FROM domain."
  default     = "bounce"

  validation {
    condition = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)*$", lower(trimspace(var.email_auth_mail_from_subdomain))))
    error_message = "email_auth_mail_from_subdomain must be a valid lowercase DNS label or dot-separated subdomain."
  }
}

variable "tags" {
  type        = map(string)
  description = "Additional tags to apply."
  default     = {}
}
