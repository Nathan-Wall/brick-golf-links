# Brick Golf Links 🧱🏌️‍♂️

Multi-domain shortlinks for sharing and personal use.

## Self-Hosting

For an end-to-end deployment guide, use [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

That guide covers:

- sign-in provider setup
- Terraform foundation setup
- GitHub secrets and variables
- first deploy
- first-login runtime domain configuration

## Stack

- React + Vite frontend
- Node + Express backend
- PostgreSQL for persistence
- Google Sign-In or email-code sign-in for authenticated link creation

## Features

- Supports multiple canonical go-link hosts
- Supports per-host aliases, so one link can resolve on multiple domains
- Public redirects for anyone
- Optional `internal_only` links that require a signed-in approved account
- Google sign-in or SES-backed email-code sign-in, with deny-all as the default until configured
- Optional super admin designation via `SUPER_ADMIN_EMAILS`
- Provisioned host infrastructure designed to be extended through `DOMAINS_JSON`

## Example Provisioned Hosts

- `go.example.com`
- `go.alt-example.com`
- `go.team.example.com`
- `go.example.org`

## Environment

Create a `.env` file in the repo root or under `server/` with:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/go_links
DATABASE_SSL=disable
# optional if you want SES-backed email-code sign-in locally
AWS_REGION=us-east-1
# optional if you want Google sign-in
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
ALLOWED_EMAILS_JSON=["person@example.net"]
ALLOWED_EMAIL_DOMAINS_JSON=["example.com","example.org"]
# set to true only if you want to allow any verified Google account
ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=false
# optional if you want SES-backed email-code sign-in
EMAIL_AUTH_FROM_EMAIL=no-reply@example.com
EMAIL_AUTH_FROM_NAME=Brick Golf Links
GOOGLE_ANALYTICS_MEASUREMENT_ID=G-XXXXXXXXXX
GOOGLE_ANALYTICS_API_SECRET=replace-with-your-ga4-measurement-protocol-api-secret
SUPER_ADMIN_EMAILS=admin@example.com,owner@example.org
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
APP_BASE_URL=http://localhost:3000
VITE_APP_BASE_URL=http://localhost:5173
DOMAINS_JSON=["localhost"]
```

For deployed environments, set `DOMAINS_JSON` to your provisioned hosts, for example:

```env
DOMAINS_JSON=["go.example.com","go.alt-example.com","go.team.example.com","go.example.org"]
```

`DOMAINS_JSON` is the canonical provisioned-host list used by the server and CDK app. Runtime canonical hosts, aliases, auth-via relationships, and default-domain behavior are managed from the database and the admin domain tools. There are no built-in host defaults anymore.

On an empty database, the migration runner now bootstraps the `domains` and `domain_host_settings` tables from `DOMAINS_JSON` instead of inheriting historical repo-specific seed domains. Provisioned hosts start as canonical domains enabled for new accounts by default and can be adjusted later from the admin UI. Alias and auth-via relationships are not seeded from deploy config.

At least one sign-in provider must be configured. Email-code sign-in uses `ALLOWED_EMAILS_JSON` and `ALLOWED_EMAIL_DOMAINS_JSON`. Google sign-in uses the same allowlists by default and can optionally allow any verified Google account via `ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=true`.

For local SES-backed email auth, the server also needs AWS credentials available through the normal AWS SDK credential chain, such as `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, or your local shared credentials file.

If both `GOOGLE_ANALYTICS_MEASUREMENT_ID` and `GOOGLE_ANALYTICS_API_SECRET` are set, the server sends GA4 Measurement Protocol events for successful shortlink opens, excluding visits by the link creator. The `go_link_open` event includes the shortlink URL plus host/internal/alias/query metadata. The `/admin` SPA is not tagged.

## Development

1. Start PostgreSQL and create the database in `DATABASE_URL`.
2. Run `npm install`.
3. Run `npm run migrate --workspace server`.
4. Run `npm run dev --workspace server`.
5. In another terminal run `npm run dev --workspace client`.

The local server applies migrations at boot as well.

## AWS serverless deployment

Use [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) as the authoritative setup path. This section is reference material for the deployment model and required inputs.

The deployment target is now split by ownership:

- Manual or Terraform-managed foundation:
  VPC, subnets, Lambda security group, Aurora PostgreSQL, RDS Proxy, ACM certificates, shared secrets
- CDK-managed app stack:
  API Gateway HTTP API, Lambda functions, migration trigger, API custom domains, and DNS records

The React admin UI is served by the backend at `/admin` on each configured go-link host. That keeps login cookies on the same host as the links themselves, which is important for `internal_only` links across multiple different domains.

The CDK app now deploys only `GoLinksAppStack`.

### Manual foundation prerequisites

Before deploying the app stack, provision these foundation resources manually or from Terraform:

- VPC ID
- Lambda security group ID
- private subnet IDs for the Lambda attachment
- availability zones for those private subnets
- ACM certificate ARN for each provisioned host in the app deploy region for API Gateway
- ACM certificate ARN for each provisioned host in `us-east-1` for CloudFront
- hosted zone IDs for each provisioned host
- JWT secret ARN in Secrets Manager
- database credentials secret ARN in Secrets Manager
- RDS Proxy or database hostname

### Terraform foundation

A starter Terraform foundation is in [terraform/foundation](terraform/foundation). It provisions:

- VPC with public and private subnets
- NAT gateway for Lambda egress
- Lambda, proxy, and database security groups
- Aurora PostgreSQL Serverless v2
- RDS Proxy
- JWT and database credentials secrets in Secrets Manager
- One regional ACM certificate per configured go-link host for API Gateway
- One `us-east-1` ACM certificate per configured go-link host for CloudFront

The foundation generates live secret material, so do not use the default local backend for a real deployment. Configure a remote backend first.

The Terraform foundation now takes a required `domains` host list in `terraform.tfvars`. Canonical, alias, and auth-via relationships are runtime concerns managed by the app and database, not by Terraform.

Basic flow:

```bash
cd terraform/foundation
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform apply
```

If you want one repo-level command that applies Terraform, syncs the Terraform-managed GitHub Actions variables, and runs the self-hosting doctor, use:

```bash
npm run apply:self-hosting -- --repo <owner/repo> --env production
```

To pass extra arguments through to `terraform apply`, add them after a second `--`:

```bash
npm run apply:self-hosting -- --repo <owner/repo> --env production -- -auto-approve
```

If you are only experimenting locally and explicitly accept local state containing secrets, run `terraform init -backend=false` instead. Do not use that for a real environment.

Then read the outputs:

```bash
terraform output
```

For the JSON-backed GitHub variables, use `terraform output -raw <name>` so you can paste the value without Terraform's surrounding quotes.

`terraform output -raw domains_json` produces the `DOMAINS_JSON` value for the app deploy, so Terraform and the runtime can now share one provisioned-host list.

To sync the Terraform-generated GitHub variable set automatically, run:

```bash
gh auth login
npm run sync:github-vars -- --repo <owner/repo> --env production
npm run doctor:self-hosting -- --repo <owner/repo> --env production
```

Or combine those steps after `terraform init` into one command:

```bash
npm run apply:self-hosting -- --repo <owner/repo> --env production
```

Omit `--env production` if you want repository-level variables instead. The sync script only manages GitHub Actions variables, not secrets. The doctor command checks Terraform output consistency, GitHub drift, and missing manual settings before deploy.

The outputs map directly to the GitHub/CDK app variables:

- `aws_region` -> `AWS_REGION`
- `domains_json` -> `DOMAINS_JSON`
- `app_vpc_id` -> `APP_VPC_ID`
- `app_lambda_security_group_id` -> `APP_LAMBDA_SECURITY_GROUP_ID`
- `app_private_subnet_ids_json` -> `APP_PRIVATE_SUBNET_IDS_JSON`
- `app_availability_zones_json` -> `APP_AVAILABILITY_ZONES_JSON`
- `app_certificate_arns_json` -> `APP_CERTIFICATE_ARNS_JSON`
- `app_edge_certificate_arns_json` -> `APP_EDGE_CERTIFICATE_ARNS_JSON`
- `app_hosted_zone_ids_json` -> `APP_HOSTED_ZONE_IDS_JSON`
- `app_jwt_secret_name` -> `APP_JWT_SECRET_NAME`
- `app_database_secret_name` -> `APP_DATABASE_SECRET_NAME`
- `app_jwt_secret_arn` -> `APP_JWT_SECRET_ARN`
- `app_database_secret_arn` -> `APP_DATABASE_SECRET_ARN`
- `app_database_host` -> `APP_DATABASE_HOST`
- `app_database_port` -> `APP_DATABASE_PORT`
- `app_database_name` -> `APP_DATABASE_NAME`

The app deploy expects them via environment variables:

```env
# optional if you want Google sign-in
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
# optional if you want SES-backed email-code sign-in
EMAIL_AUTH_FROM_EMAIL=no-reply@example.com
EMAIL_AUTH_FROM_NAME=Brick Golf Links
EMAIL_AUTH_SES_IDENTITY_ARN=arn:aws:ses:us-east-1:123456789012:identity/example.com
GOOGLE_ANALYTICS_MEASUREMENT_ID=G-XXXXXXXXXX
GOOGLE_ANALYTICS_API_SECRET=replace-with-your-ga4-measurement-protocol-api-secret
APP_VPC_ID=vpc-1234567890abcdef0
APP_LAMBDA_SECURITY_GROUP_ID=sg-1234567890abcdef0
APP_PRIVATE_SUBNET_IDS_JSON=["subnet-aaa111","subnet-bbb222"]
APP_AVAILABILITY_ZONES_JSON=["us-east-2a","us-east-2b"]
APP_CERTIFICATE_ARNS_JSON={"go.example.com":"arn:aws:acm:us-east-2:123456789012:certificate/abc123","go.alt-example.com":"arn:aws:acm:us-east-2:123456789012:certificate/def456","go.team.example.com":"arn:aws:acm:us-east-2:123456789012:certificate/ghi789","go.example.org":"arn:aws:acm:us-east-2:123456789012:certificate/jkl012"}
APP_EDGE_CERTIFICATE_ARNS_JSON={"go.example.com":"arn:aws:acm:us-east-1:123456789012:certificate/edge123","go.alt-example.com":"arn:aws:acm:us-east-1:123456789012:certificate/edge456","go.team.example.com":"arn:aws:acm:us-east-1:123456789012:certificate/edge789","go.example.org":"arn:aws:acm:us-east-1:123456789012:certificate/edge012"}
APP_HOSTED_ZONE_IDS_JSON={"go.example.com":"Z444ABC555DEF","go.alt-example.com":"Z123ABC456DEF","go.team.example.com":"Z444ABC555DEF","go.example.org":"Z789ABC123DEF"}
APP_JWT_SECRET_NAME=go-links-jwt
APP_DATABASE_SECRET_NAME=go-links-database
APP_JWT_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:go-links-jwt-AbCdEf
APP_DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:go-links-db-XyZ123
APP_DATABASE_HOST=my-proxy.proxy-abcdefghijkl.us-east-1.rds.amazonaws.com
APP_DATABASE_PORT=5432
APP_DATABASE_NAME=go_links
```

The Lambda functions read the JWT and database secrets from Secrets Manager at runtime. Use `APP_JWT_SECRET_NAME` and `APP_DATABASE_SECRET_NAME` in GitHub going forward so the deploy input stays stable even if a secret ARN changes. The ARN variables are only there as a temporary compatibility fallback.

### Deploy

```bash
npm install
npm run deploy:aws
```

This deploys only `GoLinksAppStack`.

### Bootstrap CDK

Use the dedicated bootstrap script so CDK does not need the app stack's `APP_*` variables just to bootstrap an environment:

```bash
npm run cdk:bootstrap --workspace infra -- aws://<account-id>/<region>
```

## GitHub Actions

Two workflows are included:

- `.github/workflows/ci.yml` runs `npm run lint` and `npm run build` on pull requests and pushes to `main`.
- `.github/workflows/deploy.yml` deploys the app CDK stack from `main` or manual dispatch.

### GitHub configuration

For the recommended order of operations, see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#5-configure-github-secrets-and-variables).

Configure a GitHub Actions OIDC deploy role in AWS, then set these in the repository:

- Secret: `AWS_DEPLOY_ROLE_ARN`
- Secret: `GOOGLE_CLIENT_ID` if you want Google sign-in
- Secret: `GOOGLE_ANALYTICS_API_SECRET` if you want server-side link-open analytics
- Variable: `AWS_REGION`
- Variable: `ALLOWED_EMAILS_JSON` to allow specific email addresses to sign in
- Variable: `ALLOWED_EMAIL_DOMAINS_JSON` to choose which email domains may sign in
- Variable: `ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=true` only if you want to allow any verified Google account
- Variable: `EMAIL_AUTH_FROM_EMAIL` if you want SES-backed email-code sign-in
- Variable: `EMAIL_AUTH_FROM_NAME` to customize the email-code sender display name
- Variable: `EMAIL_AUTH_SES_IDENTITY_ARN` if you want SES-backed email-code sign-in
- Variable: `GOOGLE_ANALYTICS_MEASUREMENT_ID` if you want server-side link-open analytics
- Variable: `SUPER_ADMIN_EMAILS` if you want super admins in the deployed app
- Variable: `DOMAINS_JSON` to define which provisioned hosts the app knows about. `terraform output -raw domains_json` emits the matching value if you use the Terraform foundation. Canonical/Auth via/Alias choices are still configured from the admin UI.
- Variable: `APP_VPC_ID`
- Variable: `APP_LAMBDA_SECURITY_GROUP_ID`
- Variable: `APP_PRIVATE_SUBNET_IDS_JSON`
- Variable: `APP_AVAILABILITY_ZONES_JSON`
- Variable: `APP_CERTIFICATE_ARNS_JSON`
- Variable: `APP_EDGE_CERTIFICATE_ARNS_JSON`
- Variable: `APP_HOSTED_ZONE_IDS_JSON`
- Variable: `APP_JWT_SECRET_NAME`
- Variable: `APP_DATABASE_SECRET_NAME`
- Variable: `APP_JWT_SECRET_ARN` only if you still need the legacy fallback
- Variable: `APP_DATABASE_SECRET_ARN` only if you still need the legacy fallback
- Variable: `APP_DATABASE_HOST`
- Variable: `APP_DATABASE_PORT` if not `5432`
- Variable: `APP_DATABASE_NAME` if not `go_links`

The deploy workflow targets the GitHub `production` environment. Put environment-level approvals or secret scoping there if you want a manual gate before production deploys.

If you use the Terraform foundation for SES, `EMAIL_AUTH_FROM_EMAIL`, `EMAIL_AUTH_FROM_NAME`, and `EMAIL_AUTH_SES_IDENTITY_ARN` are emitted through `github_actions_variables` automatically once `email_auth_from_email` and `email_auth_hosted_zone_domain` are configured in `terraform.tfvars`.

`APP_CERTIFICATE_ARNS_JSON` is the preferred deploy input for API Gateway custom domains because it lets each host use its own certificate and avoids leaking unrelated hostnames through shared SAN certificates. Those certificates must be in the app deploy region. `APP_EDGE_CERTIFICATE_ARNS_JSON` is the matching CloudFront input and its certificates must be in `us-east-1`. If you deploy the whole app in `us-east-1`, the stack can reuse `APP_CERTIFICATE_ARNS_JSON` for CloudFront and `APP_EDGE_CERTIFICATE_ARNS_JSON` is optional. `APP_CERTIFICATE_ARN` is still accepted as a legacy fallback, but it will reuse one certificate across every host and only works for CloudFront if that certificate is in `us-east-1`.

### Route 53 assumptions

- The relevant hosted zones already exist in Route 53.
- The app stack expects each go-link host to map to a hosted zone ID.
- For the initial setup that means every host present in `DOMAINS_JSON`, such as `go.example.com`, `go.alt-example.com`, `go.team.example.com`, and `go.example.org`.
- `APP_HOSTED_ZONE_IDS_JSON` should map each of those hosts to the hosted zone ID Route 53 should use for records. Subdomains can reuse a parent hosted zone by pointing at the same zone ID as the parent host.

### Runtime notes

- Use `https://<go-domain>/admin` for the admin UI.
- Internal-only links require authentication on the same host they are opened from.
- Lambda runs in a VPC because Aurora is private. A NAT gateway is included so the function can still verify Google tokens outbound.

## Deployment notes

- Each configured domain and alias is mapped to a CloudFront distribution that redirects HTTP to HTTPS and forwards HTTPS traffic to the API Gateway custom domain.
- In Google Cloud, configure the OAuth client with the frontend origin and authorized JavaScript origin you will use for sign-in.
- For production cookies, serve over HTTPS so `secure` cookies are accepted.
