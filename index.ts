import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

// Get configuration
const config = new pulumi.Config();

// Create a fresh VPC with 10.0.0.0/16 CIDR
const vpc = new awsx.ec2.Vpc("eks-vpc", {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 3,
    subnetSpecs: [
        {
            type: awsx.ec2.SubnetType.Public,
            cidrMask: 20,
        },
        {
            type: awsx.ec2.SubnetType.Private,
            cidrMask: 20,
        },
    ],
    natGateways: {
        strategy: awsx.ec2.NatGatewayStrategy.Single,
    },
    tags: {
        Name: "eks-vpc",
        Environment: "dev",
    },
});

// Create EKS cluster with Auto Mode enabled
const cluster = new eks.Cluster("eks-cluster", {
    vpcId: vpc.vpcId,
    // Use private subnets for the cluster
    privateSubnetIds: vpc.privateSubnetIds,
    // Use public subnets for load balancers
    publicSubnetIds: vpc.publicSubnetIds,
    // Enable EKS Auto Mode for automatic node management
    autoMode: {
        enabled: true,
    },
    // Authentication mode must be API or ApiAndConfigMap for Auto Mode
    authenticationMode: eks.AuthenticationMode.Api,
    // Skip default node groups as Auto Mode manages nodes automatically
    skipDefaultNodeGroup: true,
    // Skip default security group creation
    skipDefaultSecurityGroups: true,
    // Enable OIDC provider for IAM roles for service accounts
    createOidcProvider: true,
    // Cluster version
    version: "1.31",
    // Enable cluster logging
    enabledClusterLogTypes: [
        "api",
        "audit",
        "authenticator",
        "controllerManager",
        "scheduler",
    ],
    tags: {
        Name: "eks-auto-cluster",
        Environment: "dev",
    },
});

// Create a Kubernetes provider instance using the cluster's kubeconfig
const k8sProvider = new k8s.Provider("k8s-provider", {
    kubeconfig: cluster.kubeconfig,
});

// Install Gateway API CRDs
const gatewayApiCrds = new k8s.yaml.ConfigFile("gateway-api-crds", {
    file: "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/standard-install.yaml",
}, { provider: k8sProvider });

// Create IAM role for AWS Load Balancer Controller
const albControllerRole = new aws.iam.Role("alb-controller-role", {
    assumeRolePolicy: cluster.core.oidcProvider!.apply(oidcProvider => {
        return pulumi.all([oidcProvider!.arn, oidcProvider!.url]).apply(([arn, url]) => {
            const oidcUrl = url.replace("https://", "");
            return JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Principal: {
                        Federated: arn,
                    },
                    Action: "sts:AssumeRoleWithWebIdentity",
                    Condition: {
                        StringEquals: {
                            [`${oidcUrl}:sub`]: "system:serviceaccount:kube-system:aws-load-balancer-controller",
                            [`${oidcUrl}:aud`]: "sts.amazonaws.com",
                        },
                    },
                }],
            });
        });
    }),
});

// Attach AWS Load Balancer Controller policy
const albControllerPolicy = new aws.iam.Policy("alb-controller-policy", {
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: [
                    "iam:CreateServiceLinkedRole",
                ],
                Resource: "*",
                Condition: {
                    StringEquals: {
                        "iam:AWSServiceName": "elasticloadbalancing.amazonaws.com",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "ec2:DescribeAccountAttributes",
                    "ec2:DescribeAddresses",
                    "ec2:DescribeAvailabilityZones",
                    "ec2:DescribeInternetGateways",
                    "ec2:DescribeVpcs",
                    "ec2:DescribeVpcPeeringConnections",
                    "ec2:DescribeSubnets",
                    "ec2:DescribeSecurityGroups",
                    "ec2:DescribeInstances",
                    "ec2:DescribeNetworkInterfaces",
                    "ec2:DescribeTags",
                    "ec2:GetCoipPoolUsage",
                    "ec2:DescribeCoipPools",
                    "elasticloadbalancing:DescribeLoadBalancers",
                    "elasticloadbalancing:DescribeLoadBalancerAttributes",
                    "elasticloadbalancing:DescribeListeners",
                    "elasticloadbalancing:DescribeListenerCertificates",
                    "elasticloadbalancing:DescribeSSLPolicies",
                    "elasticloadbalancing:DescribeRules",
                    "elasticloadbalancing:DescribeTargetGroups",
                    "elasticloadbalancing:DescribeTargetGroupAttributes",
                    "elasticloadbalancing:DescribeTargetHealth",
                    "elasticloadbalancing:DescribeTags",
                ],
                Resource: "*",
            },
            {
                Effect: "Allow",
                Action: [
                    "cognito-idp:DescribeUserPoolClient",
                    "acm:ListCertificates",
                    "acm:DescribeCertificate",
                    "iam:ListServerCertificates",
                    "iam:GetServerCertificate",
                    "waf-regional:GetWebACL",
                    "waf-regional:GetWebACLForResource",
                    "waf-regional:AssociateWebACL",
                    "waf-regional:DisassociateWebACL",
                    "wafv2:GetWebACL",
                    "wafv2:GetWebACLForResource",
                    "wafv2:AssociateWebACL",
                    "wafv2:DisassociateWebACL",
                    "shield:GetSubscriptionState",
                    "shield:DescribeProtection",
                    "shield:CreateProtection",
                    "shield:DeleteProtection",
                ],
                Resource: "*",
            },
            {
                Effect: "Allow",
                Action: [
                    "ec2:AuthorizeSecurityGroupIngress",
                    "ec2:RevokeSecurityGroupIngress",
                ],
                Resource: "*",
            },
            {
                Effect: "Allow",
                Action: [
                    "ec2:CreateSecurityGroup",
                ],
                Resource: "*",
            },
            {
                Effect: "Allow",
                Action: [
                    "ec2:CreateTags",
                ],
                Resource: "arn:aws:ec2:*:*:security-group/*",
                Condition: {
                    StringEquals: {
                        "ec2:CreateAction": "CreateSecurityGroup",
                    },
                    Null: {
                        "aws:RequestTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "ec2:CreateTags",
                    "ec2:DeleteTags",
                ],
                Resource: "arn:aws:ec2:*:*:security-group/*",
                Condition: {
                    Null: {
                        "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
                        "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "ec2:AuthorizeSecurityGroupIngress",
                    "ec2:RevokeSecurityGroupIngress",
                    "ec2:DeleteSecurityGroup",
                ],
                Resource: "*",
                Condition: {
                    Null: {
                        "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:CreateLoadBalancer",
                    "elasticloadbalancing:CreateTargetGroup",
                ],
                Resource: "*",
                Condition: {
                    Null: {
                        "aws:RequestTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:CreateListener",
                    "elasticloadbalancing:DeleteListener",
                    "elasticloadbalancing:CreateRule",
                    "elasticloadbalancing:DeleteRule",
                ],
                Resource: "*",
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:AddTags",
                    "elasticloadbalancing:RemoveTags",
                ],
                Resource: [
                    "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
                    "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
                    "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*",
                ],
                Condition: {
                    Null: {
                        "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
                        "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:AddTags",
                    "elasticloadbalancing:RemoveTags",
                ],
                Resource: [
                    "arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*",
                    "arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*",
                    "arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*",
                    "arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*",
                ],
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:ModifyLoadBalancerAttributes",
                    "elasticloadbalancing:SetIpAddressType",
                    "elasticloadbalancing:SetSecurityGroups",
                    "elasticloadbalancing:SetSubnets",
                    "elasticloadbalancing:DeleteLoadBalancer",
                    "elasticloadbalancing:ModifyTargetGroup",
                    "elasticloadbalancing:ModifyTargetGroupAttributes",
                    "elasticloadbalancing:DeleteTargetGroup",
                ],
                Resource: "*",
                Condition: {
                    Null: {
                        "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:AddTags",
                ],
                Resource: [
                    "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
                    "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
                    "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*",
                ],
                Condition: {
                    StringEquals: {
                        "elasticloadbalancing:CreateAction": [
                            "CreateTargetGroup",
                            "CreateLoadBalancer",
                        ],
                    },
                    Null: {
                        "aws:RequestTag/elbv2.k8s.aws/cluster": "false",
                    },
                },
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:RegisterTargets",
                    "elasticloadbalancing:DeregisterTargets",
                ],
                Resource: "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
            },
            {
                Effect: "Allow",
                Action: [
                    "elasticloadbalancing:SetWebAcl",
                    "elasticloadbalancing:ModifyListener",
                    "elasticloadbalancing:AddListenerCertificates",
                    "elasticloadbalancing:RemoveListenerCertificates",
                    "elasticloadbalancing:ModifyRule",
                ],
                Resource: "*",
            },
        ],
    }),
});

const albControllerPolicyAttachment = new aws.iam.RolePolicyAttachment("alb-controller-policy-attachment", {
    role: albControllerRole.name,
    policyArn: albControllerPolicy.arn,
});

// Deploy AWS Load Balancer Controller using Helm
const awsLoadBalancerController = new k8s.helm.v3.Release("aws-load-balancer-controller", {
    chart: "aws-load-balancer-controller",
    version: "1.11.0",
    repositoryOpts: {
        repo: "https://aws.github.io/eks-charts",
    },
    namespace: "kube-system",
    values: {
        clusterName: cluster.eksCluster.name,
        serviceAccount: {
            create: true,
            name: "aws-load-balancer-controller",
            annotations: {
                "eks.amazonaws.com/role-arn": albControllerRole.arn,
            },
        },
        region: aws.getRegionOutput().name,
        vpcId: vpc.vpcId,
    },
}, { 
    provider: k8sProvider,
    dependsOn: [gatewayApiCrds, albControllerPolicyAttachment],
});

// Create namespace for the application
const appNamespace = new k8s.core.v1.Namespace("app-namespace", {
    metadata: {
        name: "two-tier-app",
    },
}, { provider: k8sProvider });

// Deploy Express.js Backend API
const backendDeployment = new k8s.apps.v1.Deployment("backend", {
    metadata: {
        namespace: appNamespace.metadata.name,
        labels: { app: "backend" },
    },
    spec: {
        replicas: 2,
        selector: {
            matchLabels: { app: "backend" },
        },
        template: {
            metadata: {
                labels: { app: "backend" },
            },
            spec: {
                containers: [{
                    name: "backend",
                    image: "node:20-alpine",
                    command: ["/bin/sh"],
                    args: [
                        "-c",
                        "cat > /app/server.js << 'EOF'\nconst express = require('express');\nconst os = require('os');\nconst app = express();\nconst port = 3000;\n\napp.use(express.json());\n\napp.get('/api/env', (req, res) => {\n  res.json({\n    hostname: os.hostname(),\n    platform: os.platform(),\n    arch: os.arch(),\n    nodeVersion: process.version,\n    uptime: process.uptime(),\n    memory: {\n      total: os.totalmem(),\n      free: os.freemem(),\n      used: os.totalmem() - os.freemem()\n    },\n    cpus: os.cpus().length,\n    timestamp: new Date().toISOString(),\n    environment: process.env.NODE_ENV || 'development'\n  });\n});\n\napp.get('/health', (req, res) => {\n  res.json({ status: 'healthy' });\n});\n\napp.listen(port, '0.0.0.0', () => {\n  console.log(`Backend API listening on port ${port}`);\n});\nEOF\ncd /app && npm init -y && npm install express && node server.js",
                    ],
                    ports: [{
                        containerPort: 3000,
                        name: "http",
                    }],
                    env: [{
                        name: "NODE_ENV",
                        value: "production",
                    }],
                    resources: {
                        requests: {
                            cpu: "100m",
                            memory: "128Mi",
                        },
                        limits: {
                            cpu: "500m",
                            memory: "512Mi",
                        },
                    },
                    livenessProbe: {
                        httpGet: {
                            path: "/health",
                            port: 3000,
                        },
                        initialDelaySeconds: 30,
                        periodSeconds: 10,
                    },
                    readinessProbe: {
                        httpGet: {
                            path: "/health",
                            port: 3000,
                        },
                        initialDelaySeconds: 10,
                        periodSeconds: 5,
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider });

// Create Backend Service
const backendService = new k8s.core.v1.Service("backend-service", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "backend",
    },
    spec: {
        selector: { app: "backend" },
        ports: [{
            port: 80,
            targetPort: 3000,
            protocol: "TCP",
        }],
        type: "ClusterIP",
    },
}, { provider: k8sProvider });

// Create Horizontal Pod Autoscaler for Backend with 70% CPU target
const backendHpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler("backend-hpa", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "backend-hpa",
    },
    spec: {
        scaleTargetRef: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: backendDeployment.metadata.name,
        },
        minReplicas: 2,
        maxReplicas: 10,
        metrics: [{
            type: "Resource",
            resource: {
                name: "cpu",
                target: {
                    type: "Utilization",
                    averageUtilization: 70,
                },
            },
        }],
    },
}, { provider: k8sProvider });

// Create ConfigMap for frontend HTML
const frontendHtml = new k8s.core.v1.ConfigMap("frontend-html", {
    metadata: {
        namespace: appNamespace.metadata.name,
    },
    data: {
        "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Two-Tier App</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-4xl font-bold text-center text-indigo-900 mb-8">Environment Details Dashboard</h1>
            <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-semibold text-gray-800">Backend Environment</h2>
                    <button onclick="fetchEnvDetails()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded">Refresh</button>
                </div>
                <div id="loading" class="text-center py-8">
                    <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                    <p class="mt-4 text-gray-600">Loading...</p>
                </div>
                <div id="error" class="hidden bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    <strong>Error!</strong> <span id="error-message"></span>
                </div>
                <div id="env-details" class="hidden">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Hostname</p><p class="text-lg font-semibold" id="hostname">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Platform</p><p class="text-lg font-semibold" id="platform">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Architecture</p><p class="text-lg font-semibold" id="arch">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Node Version</p><p class="text-lg font-semibold" id="nodeVersion">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">CPUs</p><p class="text-lg font-semibold" id="cpus">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Environment</p><p class="text-lg font-semibold" id="environment">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Uptime (sec)</p><p class="text-lg font-semibold" id="uptime">-</p></div>
                        <div class="bg-gray-50 p-4 rounded"><p class="text-sm text-gray-600">Timestamp</p><p class="text-lg font-semibold" id="timestamp">-</p></div>
                    </div>
                    <div class="mt-6 bg-indigo-50 p-4 rounded">
                        <h3 class="text-lg font-semibold text-indigo-900 mb-2">Memory Usage</h3>
                        <div class="grid grid-cols-3 gap-4">
                            <div><p class="text-sm text-gray-600">Total</p><p class="font-semibold" id="memTotal">-</p></div>
                            <div><p class="text-sm text-gray-600">Used</p><p class="font-semibold" id="memUsed">-</p></div>
                            <div><p class="text-sm text-gray-600">Free</p><p class="font-semibold" id="memFree">-</p></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="text-center text-gray-600">
                <p>Express.js Backend + Tailwind CSS Frontend on EKS Auto Mode</p>
            </div>
        </div>
    </div>
    <script>
        function formatBytes(b){return(b/(1024*1024*1024)).toFixed(2)+' GB'}
        async function fetchEnvDetails(){
            const l=document.getElementById('loading'),e=document.getElementById('error'),d=document.getElementById('env-details');
            l.classList.remove('hidden');e.classList.add('hidden');d.classList.add('hidden');
            try{
                const r=await fetch('/api/env');
                if(!r.ok)throw new Error('HTTP error: '+r.status);
                const data=await r.json();
                document.getElementById('hostname').textContent=data.hostname;
                document.getElementById('platform').textContent=data.platform;
                document.getElementById('arch').textContent=data.arch;
                document.getElementById('nodeVersion').textContent=data.nodeVersion;
                document.getElementById('cpus').textContent=data.cpus;
                document.getElementById('environment').textContent=data.environment;
                document.getElementById('uptime').textContent=Math.floor(data.uptime);
                document.getElementById('timestamp').textContent=new Date(data.timestamp).toLocaleString();
                document.getElementById('memTotal').textContent=formatBytes(data.memory.total);
                document.getElementById('memUsed').textContent=formatBytes(data.memory.used);
                document.getElementById('memFree').textContent=formatBytes(data.memory.free);
                l.classList.add('hidden');d.classList.remove('hidden');
            }catch(err){
                l.classList.add('hidden');e.classList.remove('hidden');
                document.getElementById('error-message').textContent=' '+err.message;
            }
        }
        fetchEnvDetails();setInterval(fetchEnvDetails,10000);
    </script>
</body>
</html>`,
    },
}, { provider: k8sProvider });

// Deploy Tailwind CSS Frontend
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    metadata: {
        namespace: appNamespace.metadata.name,
        labels: { app: "frontend" },
    },
    spec: {
        replicas: 2,
        selector: {
            matchLabels: { app: "frontend" },
        },
        template: {
            metadata: {
                labels: { app: "frontend" },
            },
            spec: {
                containers: [{
                    name: "frontend",
                    image: "nginx:alpine",
                    ports: [{
                        containerPort: 80,
                        name: "http",
                    }],
                    volumeMounts: [{
                        name: "html",
                        mountPath: "/usr/share/nginx/html",
                    }],
                    resources: {
                        requests: {
                            cpu: "50m",
                            memory: "64Mi",
                        },
                        limits: {
                            cpu: "200m",
                            memory: "256Mi",
                        },
                    },
                }],
                volumes: [{
                    name: "html",
                    configMap: {
                        name: frontendHtml.metadata.name,
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider });

// Create Frontend Service
const frontendService = new k8s.core.v1.Service("frontend-service", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "frontend",
    },
    spec: {
        selector: { app: "frontend" },
        ports: [{
            port: 80,
            targetPort: 80,
            protocol: "TCP",
        }],
        type: "ClusterIP",
    },
}, { provider: k8sProvider });

// Create Gateway for the application
const appGateway = new k8s.apiextensions.CustomResource("app-gateway", {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "Gateway",
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "app-gateway",
    },
    spec: {
        gatewayClassName: "aws-alb",
        listeners: [{
            name: "http",
            protocol: "HTTP",
            port: 80,
        }],
    },
}, { provider: k8sProvider, dependsOn: [awsLoadBalancerController] });

// Create HTTPRoute to expose frontend
const frontendRoute = new k8s.apiextensions.CustomResource("frontend-route", {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "frontend-route",
    },
    spec: {
        parentRefs: [{
            name: appGateway.metadata.name,
        }],
        rules: [
            {
                matches: [{
                    path: {
                        type: "PathPrefix",
                        value: "/api",
                    },
                }],
                backendRefs: [{
                    name: backendService.metadata.name,
                    port: 80,
                }],
            },
            {
                matches: [{
                    path: {
                        type: "PathPrefix",
                        value: "/",
                    },
                }],
                backendRefs: [{
                    name: frontendService.metadata.name,
                    port: 80,
                }],
            },
        ],
    },
}, { provider: k8sProvider, dependsOn: [appGateway] });

// Export the cluster's kubeconfig and important endpoints
export const kubeconfig = cluster.kubeconfig;
export const clusterName = cluster.eksCluster.name;
export const vpcId = vpc.vpcId;
export const appNamespaceName = appNamespace.metadata.name;
export const frontendServiceName = frontendService.metadata.name;
export const backendServiceName = backendService.metadata.name;
