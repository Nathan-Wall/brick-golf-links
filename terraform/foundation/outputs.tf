output "app_vpc_id" {
  value       = aws_vpc.go_links.id
  description = "Set as APP_VPC_ID for the CDK app deploy."
}

output "app_lambda_security_group_id" {
  value       = aws_security_group.lambda.id
  description = "Set as APP_LAMBDA_SECURITY_GROUP_ID for the CDK app deploy."
}

output "app_private_subnet_ids_json" {
  value       = jsonencode([for az in local.azs : aws_subnet.private[az].id])
  description = "Set as APP_PRIVATE_SUBNET_IDS_JSON for the CDK app deploy."
}

output "app_availability_zones_json" {
  value       = jsonencode(local.azs)
  description = "Set as APP_AVAILABILITY_ZONES_JSON for the CDK app deploy."
}

output "domains_json" {
  value       = jsonencode(local.domain_hosts)
  description = "Set as DOMAINS_JSON for the app deploy."
}

output "app_certificate_arns_json" {
  value = jsonencode({
    for host, validation in aws_acm_certificate_validation.go_links_by_host :
    host => validation.certificate_arn
  })
  description = "Set as APP_CERTIFICATE_ARNS_JSON for the CDK app deploy. These certificates must be in the app's deploy region for API Gateway custom domains."
}

output "app_edge_certificate_arns_json" {
  value = jsonencode({
    for host, validation in aws_acm_certificate_validation.go_links_edge_by_host :
    host => validation.certificate_arn
  })
  description = "Set as APP_EDGE_CERTIFICATE_ARNS_JSON for the CDK app deploy. These certificates are issued in us-east-1 for CloudFront."
}

output "app_hosted_zone_ids_json" {
  value       = jsonencode(local.hosted_zone_ids_by_host)
  description = "Set as APP_HOSTED_ZONE_IDS_JSON for the CDK app deploy."
}

output "app_jwt_secret_arn" {
  value       = aws_secretsmanager_secret.jwt.arn
  description = "Legacy fallback: set as APP_JWT_SECRET_ARN for the CDK app deploy if you are not using APP_JWT_SECRET_NAME."
}

output "app_jwt_secret_name" {
  value       = aws_secretsmanager_secret.jwt.name
  description = "Set as APP_JWT_SECRET_NAME for the CDK app deploy."
}

output "app_database_secret_arn" {
  value       = aws_secretsmanager_secret.database.arn
  description = "Legacy fallback: set as APP_DATABASE_SECRET_ARN for the CDK app deploy if you are not using APP_DATABASE_SECRET_NAME."
}

output "app_database_secret_name" {
  value       = aws_secretsmanager_secret.database.name
  description = "Set as APP_DATABASE_SECRET_NAME for the CDK app deploy."
}

output "app_database_host" {
  value       = aws_db_proxy.go_links.endpoint
  description = "Set as APP_DATABASE_HOST for the CDK app deploy."
}

output "app_database_port" {
  value       = 5432
  description = "Set as APP_DATABASE_PORT for the CDK app deploy."
}

output "app_database_name" {
  value       = var.database_name
  description = "Set as APP_DATABASE_NAME for the CDK app deploy."
}

output "aws_region" {
  value       = var.aws_region
  description = "Set as AWS_REGION for the GitHub deploy workflow."
}

output "email_auth_from_email" {
  value       = local.email_auth_enabled ? local.email_auth_from_email : ""
  description = "Set as EMAIL_AUTH_FROM_EMAIL for the app deploy when SES-backed email auth is enabled."
}

output "email_auth_from_name" {
  value       = local.email_auth_enabled ? local.email_auth_from_name : ""
  description = "Set as EMAIL_AUTH_FROM_NAME for the app deploy when SES-backed email auth is enabled."
}

output "email_auth_ses_identity_arn" {
  value       = try(aws_ses_domain_identity.email_auth[0].arn, "")
  description = "Set as EMAIL_AUTH_SES_IDENTITY_ARN for the CDK app deploy when SES-backed email auth is enabled."
}

output "github_actions_variables" {
  value = {
    AWS_REGION                    = var.aws_region
    DOMAINS_JSON                  = jsonencode(local.domain_hosts)
    EMAIL_AUTH_FROM_EMAIL         = local.email_auth_enabled ? local.email_auth_from_email : ""
    EMAIL_AUTH_FROM_NAME          = local.email_auth_enabled ? local.email_auth_from_name : ""
    EMAIL_AUTH_SES_IDENTITY_ARN   = try(aws_ses_domain_identity.email_auth[0].arn, "")
    APP_VPC_ID                    = aws_vpc.go_links.id
    APP_LAMBDA_SECURITY_GROUP_ID  = aws_security_group.lambda.id
    APP_PRIVATE_SUBNET_IDS_JSON   = jsonencode([for az in local.azs : aws_subnet.private[az].id])
    APP_AVAILABILITY_ZONES_JSON   = jsonencode(local.azs)
    APP_CERTIFICATE_ARNS_JSON     = jsonencode({
      for host, validation in aws_acm_certificate_validation.go_links_by_host :
      host => validation.certificate_arn
    })
    APP_EDGE_CERTIFICATE_ARNS_JSON = jsonencode({
      for host, validation in aws_acm_certificate_validation.go_links_edge_by_host :
      host => validation.certificate_arn
    })
    APP_HOSTED_ZONE_IDS_JSON      = jsonencode(local.hosted_zone_ids_by_host)
    APP_JWT_SECRET_NAME           = aws_secretsmanager_secret.jwt.name
    APP_DATABASE_SECRET_NAME      = aws_secretsmanager_secret.database.name
    APP_JWT_SECRET_ARN            = aws_secretsmanager_secret.jwt.arn
    APP_DATABASE_SECRET_ARN       = aws_secretsmanager_secret.database.arn
    APP_DATABASE_HOST             = aws_db_proxy.go_links.endpoint
    APP_DATABASE_PORT             = 5432
    APP_DATABASE_NAME             = var.database_name
  }
  description = "Values to sync into GitHub Actions variables."
}
