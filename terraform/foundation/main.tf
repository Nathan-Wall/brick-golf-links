data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  tags = merge(var.tags, {
    Project = var.name
  })

  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  domain_hosts = distinct([
    for host in var.domains : lower(trimspace(host))
    if length(trimspace(host)) > 0
  ])

  hosted_zone_names_by_host = {
    for host in local.domain_hosts :
    host => split(":", sort([
      for candidate in local.domain_hosts :
      format("%03d:%s", length(split(".", candidate)), candidate)
      if host == candidate || endswith(host, ".${candidate}")
    ])[0])[1]
  }

  hosted_zone_names = distinct(values(local.hosted_zone_names_by_host))

  hosted_zone_ids_by_name = {
    for zone_name, zone in data.aws_route53_zone.by_name : zone_name => zone.zone_id
  }

  hosted_zone_ids_by_host = {
    for host, zone_name in local.hosted_zone_names_by_host :
    host => local.hosted_zone_ids_by_name[zone_name]
  }

  db_secret_value = jsonencode({
    username = var.database_username
    password = random_password.db_password.result
  })

  email_auth_from_email       = lower(trimspace(var.email_auth_from_email))
  email_auth_enabled          = length(local.email_auth_from_email) > 0
  email_auth_from_domain      = local.email_auth_enabled ? split("@", local.email_auth_from_email)[1] : null
  email_auth_from_name        = trimspace(var.email_auth_from_name)
  email_auth_hosted_zone_name = lower(trimspace(var.email_auth_hosted_zone_domain))
  email_auth_mail_from_domain = local.email_auth_enabled ? "${lower(trimspace(var.email_auth_mail_from_subdomain))}.${local.email_auth_from_domain}" : null
}

data "aws_route53_zone" "by_name" {
  for_each     = toset(local.hosted_zone_names)
  name         = each.value
  private_zone = false
}

data "aws_route53_zone" "email_auth" {
  count        = local.email_auth_enabled ? 1 : 0
  name         = local.email_auth_hosted_zone_name
  private_zone = false
}

resource "aws_vpc" "go_links" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.tags, {
    Name = "${var.name}-vpc"
  })
}

resource "aws_internet_gateway" "go_links" {
  vpc_id = aws_vpc.go_links.id

  tags = merge(local.tags, {
    Name = "${var.name}-igw"
  })
}

resource "aws_subnet" "public" {
  for_each = {
    for idx, az in local.azs : az => {
      cidr_block = cidrsubnet(var.vpc_cidr, 8, idx)
      az         = az
    }
  }

  vpc_id                  = aws_vpc.go_links.id
  cidr_block              = each.value.cidr_block
  availability_zone       = each.value.az
  map_public_ip_on_launch = true

  tags = merge(local.tags, {
    Name = "${var.name}-public-${replace(each.key, "/[^a-zA-Z0-9-]/", "-")}"
  })
}

resource "aws_subnet" "private" {
  for_each = {
    for idx, az in local.azs : az => {
      cidr_block = cidrsubnet(var.vpc_cidr, 8, idx + 10)
      az         = az
    }
  }

  vpc_id            = aws_vpc.go_links.id
  cidr_block        = each.value.cidr_block
  availability_zone = each.value.az

  tags = merge(local.tags, {
    Name = "${var.name}-private-${replace(each.key, "/[^a-zA-Z0-9-]/", "-")}"
  })
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = merge(local.tags, {
    Name = "${var.name}-nat-eip"
  })
}

resource "aws_nat_gateway" "go_links" {
  allocation_id = aws_eip.nat.id
  subnet_id     = values(aws_subnet.public)[0].id

  tags = merge(local.tags, {
    Name = "${var.name}-nat"
  })

  depends_on = [aws_internet_gateway.go_links]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.go_links.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.go_links.id
  }

  tags = merge(local.tags, {
    Name = "${var.name}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.go_links.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.go_links.id
  }

  tags = merge(local.tags, {
    Name = "${var.name}-private-rt"
  })
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "lambda" {
  name        = "${var.name}-lambda"
  description = "Lambda security group for go-links app."
  vpc_id      = aws_vpc.go_links.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${var.name}-lambda-sg"
  })
}

resource "aws_security_group" "proxy" {
  name        = "${var.name}-proxy"
  description = "RDS Proxy security group."
  vpc_id      = aws_vpc.go_links.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${var.name}-proxy-sg"
  })
}

resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "Aurora cluster security group."
  vpc_id      = aws_vpc.go_links.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${var.name}-database-sg"
  })
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.name}-vpc-endpoints"
  description = "Interface VPC endpoint security group."
  vpc_id      = aws_vpc.go_links.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${var.name}-vpc-endpoints-sg"
  })
}

resource "aws_security_group_rule" "lambda_to_proxy" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.proxy.id
  source_security_group_id = aws_security_group.lambda.id
}

resource "aws_security_group_rule" "lambda_to_vpc_endpoints" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.vpc_endpoints.id
  source_security_group_id = aws_security_group.lambda.id
}

resource "aws_security_group_rule" "proxy_to_database" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.database.id
  source_security_group_id = aws_security_group.proxy.id
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name = "${var.name}-jwt"

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "database" {
  name = "${var.name}-database"

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id     = aws_secretsmanager_secret.database.id
  secret_string = local.db_secret_value
}

resource "aws_ses_domain_identity" "email_auth" {
  count  = local.email_auth_enabled ? 1 : 0
  domain = local.email_auth_from_domain
}

resource "aws_route53_record" "email_auth_verification" {
  count = local.email_auth_enabled ? 1 : 0

  allow_overwrite = true
  zone_id         = data.aws_route53_zone.email_auth[0].zone_id
  name            = "_amazonses.${aws_ses_domain_identity.email_auth[0].domain}"
  type            = "TXT"
  ttl             = 600
  records         = [aws_ses_domain_identity.email_auth[0].verification_token]
}

resource "aws_ses_domain_identity_verification" "email_auth" {
  count  = local.email_auth_enabled ? 1 : 0
  domain = aws_ses_domain_identity.email_auth[0].id

  depends_on = [aws_route53_record.email_auth_verification]
}

resource "aws_ses_domain_dkim" "email_auth" {
  count  = local.email_auth_enabled ? 1 : 0
  domain = aws_ses_domain_identity.email_auth[0].domain

  depends_on = [aws_ses_domain_identity_verification.email_auth]
}

resource "aws_route53_record" "email_auth_dkim" {
  for_each = local.email_auth_enabled ? {
    dkim_1 = 0
    dkim_2 = 1
    dkim_3 = 2
  } : {}

  allow_overwrite = true
  zone_id         = data.aws_route53_zone.email_auth[0].zone_id
  name            = "${aws_ses_domain_dkim.email_auth[0].dkim_tokens[each.value]}._domainkey.${local.email_auth_from_domain}"
  type            = "CNAME"
  ttl             = 600
  records         = ["${aws_ses_domain_dkim.email_auth[0].dkim_tokens[each.value]}.dkim.amazonses.com"]
}

resource "aws_ses_domain_mail_from" "email_auth" {
  count = local.email_auth_enabled ? 1 : 0

  domain                = aws_ses_domain_identity.email_auth[0].domain
  mail_from_domain      = local.email_auth_mail_from_domain
  behavior_on_mx_failure = "UseDefaultValue"

  depends_on = [aws_ses_domain_identity_verification.email_auth]
}

resource "aws_route53_record" "email_auth_mail_from_mx" {
  count = local.email_auth_enabled ? 1 : 0

  allow_overwrite = true
  zone_id         = data.aws_route53_zone.email_auth[0].zone_id
  name            = aws_ses_domain_mail_from.email_auth[0].mail_from_domain
  type            = "MX"
  ttl             = 600
  records         = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "email_auth_mail_from_txt" {
  count = local.email_auth_enabled ? 1 : 0

  allow_overwrite = true
  zone_id         = data.aws_route53_zone.email_auth[0].zone_id
  name            = aws_ses_domain_mail_from.email_auth[0].mail_from_domain
  type            = "TXT"
  ttl             = 600
  records         = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_db_subnet_group" "go_links" {
  name       = "${var.name}-db-subnets"
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]

  tags = merge(local.tags, {
    Name = "${var.name}-db-subnets"
  })
}

resource "aws_rds_cluster" "go_links" {
  cluster_identifier   = var.name
  engine               = "aurora-postgresql"
  engine_version       = "16.4"
  database_name        = var.database_name
  master_username      = var.database_username
  master_password      = random_password.db_password.result
  db_subnet_group_name = aws_db_subnet_group.go_links.name
  storage_encrypted    = true
  skip_final_snapshot  = true

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 8
  }

  vpc_security_group_ids = [aws_security_group.database.id]

  tags = local.tags
}

resource "aws_rds_cluster_instance" "writer" {
  identifier         = "${var.name}-writer-1"
  cluster_identifier = aws_rds_cluster.go_links.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.go_links.engine
  engine_version     = aws_rds_cluster.go_links.engine_version

  tags = local.tags
}

data "aws_iam_policy_document" "proxy_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.name}-proxy-role"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume_role.json

  tags = local.tags
}

data "aws_iam_policy_document" "proxy_secrets" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [aws_secretsmanager_secret.database.arn]
  }
}

resource "aws_iam_role_policy" "proxy_secrets" {
  name   = "${var.name}-proxy-secrets"
  role   = aws_iam_role.proxy.id
  policy = data.aws_iam_policy_document.proxy_secrets.json
}

resource "aws_db_proxy" "go_links" {
  name                   = var.name
  engine_family          = "POSTGRESQL"
  idle_client_timeout    = 1800
  require_tls            = true
  role_arn               = aws_iam_role.proxy.arn
  vpc_subnet_ids         = [for subnet in aws_subnet.private : subnet.id]
  vpc_security_group_ids = [aws_security_group.proxy.id]

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.database.arn
  }

  tags = local.tags
}

resource "aws_db_proxy_default_target_group" "go_links" {
  db_proxy_name = aws_db_proxy.go_links.name

  connection_pool_config {
    max_connections_percent      = 100
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "cluster" {
  db_proxy_name         = aws_db_proxy.go_links.name
  target_group_name     = aws_db_proxy_default_target_group.go_links.name
  db_cluster_identifier = aws_rds_cluster.go_links.cluster_identifier
}

resource "aws_vpc_endpoint" "sqs" {
  vpc_id              = aws_vpc.go_links.id
  service_name        = "com.amazonaws.${var.aws_region}.sqs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(local.tags, {
    Name = "${var.name}-sqs-endpoint"
  })
}

resource "aws_acm_certificate" "go_links_by_host" {
  for_each          = toset(local.domain_hosts)
  domain_name       = each.key
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for host, certificate in aws_acm_certificate.go_links_by_host :
    host => {
      name   = tolist(certificate.domain_validation_options)[0].resource_record_name
      record = tolist(certificate.domain_validation_options)[0].resource_record_value
      type   = tolist(certificate.domain_validation_options)[0].resource_record_type
      zone   = local.hosted_zone_names_by_host[host]
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.hosted_zone_ids_by_name[each.value.zone]
}

resource "aws_acm_certificate_validation" "go_links_by_host" {
  for_each                = aws_acm_certificate.go_links_by_host
  certificate_arn         = each.value.arn
  validation_record_fqdns = [aws_route53_record.certificate_validation[each.key].fqdn]
}

resource "aws_acm_certificate" "go_links_edge_by_host" {
  provider          = aws.us_east_1
  for_each          = toset(local.domain_hosts)
  domain_name       = each.key
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

resource "aws_acm_certificate_validation" "go_links_edge_by_host" {
  provider                = aws.us_east_1
  for_each                = aws_acm_certificate.go_links_edge_by_host
  certificate_arn         = each.value.arn
  validation_record_fqdns = [aws_route53_record.certificate_validation[each.key].fqdn]
}
