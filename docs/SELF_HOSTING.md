# Self-Hosting Guide

This guide is the authoritative setup path for deploying the app with your own Google accounts or Amazon SES setup, your own AWS account, and your own domains.

## What This App Expects

At deploy time, the app needs:

- A list of provisioned hosts in `DOMAINS_JSON`
- At least one sign-in provider configured for the deployed admin origins
- AWS infrastructure for the app runtime and database
- Per-host certificates and hosted zone mappings
- At least one account allowed to sign in
- At least one super admin so the runtime domain relationships can be managed from the admin UI

Important separation of concerns:

- `DOMAINS_JSON` is only a list of provisioned hosts
- Canonical, `Auth via`, and `Alias` relationships are runtime settings stored in the database
- On a fresh database, provisioned hosts start as canonical domains enabled for new accounts by default

## Deployment Model

The deployment is split into two layers:

- Terraform foundation:
  VPC, subnets, security groups, Aurora PostgreSQL, RDS Proxy, Secrets Manager secrets, ACM certificates
- CDK app stack:
  API Gateway, Lambda functions, migration trigger, per-host custom domains, CloudFront, and Route 53 records

The included GitHub Actions deploy workflow expects the CDK app stack inputs to come from repository or environment variables and secrets in GitHub.

## 1. Choose Your Hosts

Decide which hosts should serve shortlinks. Example:

```json
["go.example.com","go.team.example.com","links.example.org"]
```

These are the hosts you provision certificates and DNS for.

Do not encode alias relationships here. If `go.team.example.com` should be an alias of `go.example.com`, provision both hosts, deploy them both, and then configure the relationship later in the admin UI.

## 2. Configure Sign-In

Choose at least one sign-in provider:

- Google OAuth
- Email codes over Amazon SES

For Google sign-in, create a Google OAuth client for browser sign-in and set:

- `GOOGLE_CLIENT_ID`

You must configure the OAuth client to allow the deployed admin origins. For example, if users will sign in on `https://go.example.com/admin`, configure the matching frontend origin and JavaScript origin in Google Cloud.

For SES-backed email-code sign-in, configure the Terraform foundation with:

- `email_auth_from_email`
- `email_auth_hosted_zone_domain`
- optionally `email_auth_from_name`
- optionally `email_auth_mail_from_subdomain`

That foundation config provisions the SES domain identity, Route53 verification records, DKIM records, and a custom MAIL FROM domain. The app deploy then consumes the emitted `EMAIL_AUTH_FROM_EMAIL`, `EMAIL_AUTH_FROM_NAME`, and `EMAIL_AUTH_SES_IDENTITY_ARN` variables.

The app defaults to deny-all unless one of these is configured:

- `ALLOWED_EMAILS_JSON`
- `ALLOWED_EMAIL_DOMAINS_JSON`
- `ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=true`

Recommended production posture:

- Set `ALLOWED_EMAIL_DOMAINS_JSON` to the domains you want to allow
- Optionally set `ALLOWED_EMAILS_JSON` for specific exceptions
- Leave `ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS` unset or `false` unless you explicitly want any verified Google account to be allowed

Example:

```env
# optional if you want Google sign-in
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
ALLOWED_EMAILS_JSON=["admin@example.net"]
ALLOWED_EMAIL_DOMAINS_JSON=["example.com","example.org"]
ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=false
SUPER_ADMIN_EMAILS=admin@example.com
```

Set `SUPER_ADMIN_EMAILS` before first use. Without a super admin, you will not be able to manage domains and other global settings from the UI.

If you enable SES-backed email auth, request production access for SES manually after provisioning. Terraform can create the identity and DNS records, but it does not move the AWS account out of the SES sandbox.

## 3. Provision the AWS Foundation

The starter Terraform foundation lives in [terraform/foundation](/workspace/terraform/foundation).

Copy the examples:

```bash
cd terraform/foundation
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
aws_region = "us-east-1"
name       = "go-links"

domains = [
  "go.example.com",
  "go.team.example.com",
  "links.example.org"
]

# optional SES-backed email-code sign-in
email_auth_from_email        = "no-reply@example.com"
email_auth_from_name         = "Brick Golf Links"
email_auth_hosted_zone_domain = "example.com"
email_auth_mail_from_subdomain = "bounce"
```

Notes:

- `domains` is a flat host list
- Terraform provisions infrastructure for every host in that list
- Subdomains can reuse a parent hosted zone if Route 53 already manages the parent zone

Initialize and apply:

```bash
terraform init -backend-config=backend.hcl
terraform apply
```

If you want a single command that runs `terraform apply`, syncs the Terraform-managed GitHub Actions variables, and then runs the self-hosting doctor, use:

```bash
npm run apply:self-hosting -- --repo <owner/repo> --env production
```

To pass extra arguments to Terraform, add them after a second `--`:

```bash
npm run apply:self-hosting -- --repo <owner/repo> --env production -- -auto-approve
```

If you are only experimenting locally and accept local state containing secrets, you can use:

```bash
terraform init -backend=false
```

Do not use local state for a real deployment.

## 4. Collect Terraform Outputs

After `terraform apply`, collect the outputs:

```bash
terraform output
terraform output -raw domains_json
terraform output -raw app_certificate_arns_json
terraform output -raw app_edge_certificate_arns_json
terraform output -raw app_hosted_zone_ids_json
terraform output -raw github_actions_variables
```

The most important mapping is:

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
- `app_database_host` -> `APP_DATABASE_HOST`
- `app_database_port` -> `APP_DATABASE_PORT`
- `app_database_name` -> `APP_DATABASE_NAME`

Legacy fallback outputs still exist:

- `app_jwt_secret_arn` -> `APP_JWT_SECRET_ARN`
- `app_database_secret_arn` -> `APP_DATABASE_SECRET_ARN`

Prefer the secret name variables over the ARN fallback variables.

## 5. Configure GitHub Secrets and Variables

The deploy workflow is in [.github/workflows/deploy.yml](/workspace/.github/workflows/deploy.yml#L1) and deploys from `main` or manual dispatch into the GitHub `production` environment.

The fastest handoff path is to sync the Terraform-produced GitHub variable map directly:

```bash
gh auth login
npm run sync:github-vars -- --repo <owner/repo> --env production
npm run doctor:self-hosting -- --repo <owner/repo> --env production
```

Or, after `terraform init`, let the wrapper run apply plus sync plus doctor in one go:

```bash
npm run apply:self-hosting -- --repo <owner/repo> --env production
```

Notes:

- `--env production` is optional. Omit it if you want repository-level variables instead.
- The script reads `terraform/foundation` by default and syncs the `github_actions_variables` output.
- The script only syncs GitHub Actions variables. You still need to manage secrets manually.
- The doctor command checks local tool/auth health, Terraform output consistency, GitHub variable drift, and required manual settings before deploy.

Required GitHub secret values:

- `AWS_DEPLOY_ROLE_ARN`

Optional GitHub secret values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_ANALYTICS_API_SECRET`

Required GitHub variables:

- `AWS_REGION`
- `DOMAINS_JSON`
- `APP_VPC_ID`
- `APP_LAMBDA_SECURITY_GROUP_ID`
- `APP_PRIVATE_SUBNET_IDS_JSON`
- `APP_AVAILABILITY_ZONES_JSON`
- `APP_CERTIFICATE_ARNS_JSON`
- `APP_HOSTED_ZONE_IDS_JSON`
- `APP_JWT_SECRET_NAME`
- `APP_DATABASE_SECRET_NAME`
- `APP_DATABASE_HOST`

Usually required GitHub variables:

- `APP_EDGE_CERTIFICATE_ARNS_JSON`
  Set this unless your entire app deploy is in `us-east-1` and you are intentionally reusing the regional certificate map for CloudFront.

Optional GitHub variables:

- `ALLOWED_EMAILS_JSON`
- `ALLOWED_EMAIL_DOMAINS_JSON`
- `ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS`
- `EMAIL_AUTH_FROM_EMAIL`
- `EMAIL_AUTH_FROM_NAME`
- `EMAIL_AUTH_SES_IDENTITY_ARN`
- `SUPER_ADMIN_EMAILS`
- `GOOGLE_ANALYTICS_MEASUREMENT_ID`
- `APP_DATABASE_PORT`
- `APP_DATABASE_NAME`
- `APP_JWT_SECRET_ARN`
- `APP_DATABASE_SECRET_ARN`
- `APP_CERTIFICATE_ARN`

Recommended minimum production config:

```env
AWS_REGION=us-east-1
DOMAINS_JSON=["go.example.com","go.team.example.com","links.example.org"]
ALLOWED_EMAIL_DOMAINS_JSON=["example.com"]
ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=false
EMAIL_AUTH_FROM_EMAIL=no-reply@example.com
EMAIL_AUTH_SES_IDENTITY_ARN=arn:aws:ses:us-east-1:123456789012:identity/example.com
SUPER_ADMIN_EMAILS=admin@example.com
```

## 6. Bootstrap CDK

Before the first deploy, bootstrap the target AWS account and region:

```bash
npm install
npm run cdk:bootstrap --workspace infra -- aws://<account-id>/<region>
```

This only needs to be done once per account and region.

## 7. Deploy the App

You can deploy from GitHub Actions or locally.

GitHub Actions:

- Push to `main`, or
- Run the `Deploy` workflow manually

Local:

```bash
npm install
npm run deploy:aws
```

Local deploys still require the same environment variables that the GitHub workflow uses.

## 8. First Login and Runtime Setup

After deploy:

1. Visit `https://<one-of-your-hosts>/admin`
2. Sign in with an allowed Google account
3. Make sure that account is included in `SUPER_ADMIN_EMAILS`
4. Open the Domains page
5. Configure each provisioned host as needed:
   - Canonical
   - `Auth via`
   - `Alias`
6. Adjust:
   - default for new accounts
   - root redirect slug
   - any auth-provider relationships

This is the point where you define cross-domain behavior. That configuration is stored in the database, not in `DOMAINS_JSON`.

## 9. Route 53 and Certificates

The app stack expects:

- Every provisioned host in `DOMAINS_JSON` to have a hosted zone mapping in `APP_HOSTED_ZONE_IDS_JSON`
- Every provisioned host in `APP_CERTIFICATE_ARNS_JSON` to have a regional ACM certificate in the app deploy region
- Every provisioned host in `APP_EDGE_CERTIFICATE_ARNS_JSON` to have a `us-east-1` ACM certificate for CloudFront

Important certificate rule:

- CloudFront certificates must be in `us-east-1`

If you use shared hosted zones:

- A subdomain can reuse the parent hosted zone ID
- Example: `go.team.example.com` can point at the same hosted zone ID as `example.com` if that zone is authoritative

## 10. Optional Analytics

To enable server-side analytics tracking for shortlink opens:

- set `GOOGLE_ANALYTICS_MEASUREMENT_ID`
- set `GOOGLE_ANALYTICS_API_SECRET`

If either is missing, analytics events are not sent.

## 11. Local Development

For local development, a minimal `.env` can look like:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/go_links
DATABASE_SSL=disable
# optional if you want SES-backed email-code sign-in locally
AWS_REGION=us-east-1
# optional if you want Google sign-in
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
# optional if you want SES-backed email-code sign-in
EMAIL_AUTH_FROM_EMAIL=no-reply@example.com
EMAIL_AUTH_FROM_NAME=Brick Golf Links
ALLOWED_EMAILS_JSON=["person@example.net"]
ALLOWED_EMAIL_DOMAINS_JSON=["example.com"]
ALLOW_ALL_VERIFIED_GOOGLE_ACCOUNTS=false
SUPER_ADMIN_EMAILS=person@example.net
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
APP_BASE_URL=http://localhost:3000
VITE_APP_BASE_URL=http://localhost:5173
DOMAINS_JSON=["localhost"]
```

Then run:

```bash
npm install
npm run migrate --workspace server
npm run dev --workspace server
npm run dev --workspace client
```

For local SES-backed email auth, make AWS credentials available through the AWS SDK default credential chain, such as `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, or your shared credentials file.

## Common Pitfalls

- `DOMAINS_JSON` is a host list, not a place to define aliases
- If no allowlist variables are configured, sign-in is denied for everyone
- If `SUPER_ADMIN_EMAILS` is empty, no one can manage domains from the UI
- `APP_EDGE_CERTIFICATE_ARNS_JSON` must reference `us-east-1` certificates
- Internal-only links require an active signed-in viewer context; `Auth via` hosts satisfy that through their configured auth provider host
- On an existing database, changing `DOMAINS_JSON` does not rewrite Canonical/Auth via/Alias relationships; it only changes the provisioned host set available to the runtime
