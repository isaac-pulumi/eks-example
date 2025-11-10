# EKS Microservices Application

This project provisions an Amazon EKS cluster with a complete microservices application stack.

- **EKS Cluster**: 3 t3.small nodes in the default VPC
- **Microservices**:
  - React Frontend (nginx)
  - Node.js Backend API (with HPA at 70% CPU)
  - Redis Cache
- **Infrastructure**:
  - NGINX Ingress Controller
  - cert-manager for Let's Encrypt HTTPS certificates
  - Horizontal Pod Autoscaler for backend (2-10 replicas)

## Prerequisites

- AWS account with appropriate permissions
- Pulumi account
- Node.js 20+
- kubectl (optional, for cluster access)

## Configuration

The stack uses Pulumi ESC environment `aws-login/pulumi-dev-sandbox-env` for AWS credentials.

Set the following configuration values:

```bash
pulumi config set aws:region us-west-2
pulumi config set domain your-domain.com
pulumi config set letsencryptEmail your-email@example.com
```

## GitHub Actions Setup

The project includes a CI/CD pipeline that:
- Runs `pulumi preview` on pull requests
- Runs `pulumi up` on pushes to main
- Uses Pulumi ESC for AWS credentials (no need for AWS OIDC setup)

### Required GitHub Secret

Only one secret is needed:

**PULUMI_ACCESS_TOKEN**: Your Pulumi access token
- Get it from: https://app.pulumi.com/account/tokens
- Set it in GitHub: https://github.com/isaac-pulumi/eks-example/settings/secrets/actions

AWS credentials are automatically provided by the ESC environment `aws-login/pulumi-dev-sandbox-env`.

## Deployment

### Local Deployment

```bash
# Install dependencies
npm install

# Initialize stack (if not already done)
pulumi stack init dev

# Configure AWS region and domain
pulumi config set aws:region us-west-2
pulumi config set domain your-domain.com
pulumi config set letsencryptEmail your-email@example.com

# Preview changes
pulumi preview

# Deploy
pulumi up
```

### Via GitHub Actions

1. Set the `PULUMI_ACCESS_TOKEN` secret in GitHub
2. Push code to a branch
3. Create a pull request to see preview
4. Merge to main to deploy

## Accessing the Application

After deployment:

1. Get the load balancer hostname:
   ```bash
   kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
   ```

2. Point your domain DNS to the load balancer hostname (CNAME record)

3. Wait for Let's Encrypt certificate to be issued (usually 1-2 minutes)

4. Access your application at `https://your-domain.com`

## Application Architecture

```
Internet
    |
    v
NGINX Ingress (HTTPS via Let's Encrypt)
    |
    +-- / --> Frontend (React/nginx)
    |
    +-- /api --> Backend (Node.js)
                    |
                    v
                 Redis Cache
```

## Horizontal Pod Autoscaling

The backend API automatically scales between 2-10 replicas based on CPU utilization:
- Target: 70% CPU
- Min replicas: 2
- Maax replicas: 10

## Customization

### Using Your Own Container Images

Replace the sample images in `index.ts`:

```typescript
// Frontend
image: "your-registry/frontend:tag"

// Backend
image: "your-registry/backend:tag"
```

### Adjusting Resources

Modify resource requests/limits in the deployment specs in `index.ts`.

## Cleanup

To destroy all resources:

```bash
pulumi destroy
```

## Outputs

- `kubeconfig`: Kubernetes configuration for cluster access
- FclusterName`: Name of the EKS cluster
- `appUrl`: Application URL (after DNS configuration)
- `getLoadBalancerCommand`: Command to retrieve the load balancer hostname
