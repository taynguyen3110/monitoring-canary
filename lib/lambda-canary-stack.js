const { Stack, Duration } = require('aws-cdk-lib');
const cdk = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam');
const lambda = require('aws-cdk-lib/aws-lambda');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const cloudwatchActions = require('aws-cdk-lib/aws-cloudwatch-actions');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
// const path = require('path');

class LambdaCanaryStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create S3 bucket for artifacts
    const bucket = new s3.Bucket(this, 'LambdaLogsBucket', {
      bucketName: 'lambdacanary-logs-bucket062024',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // Create IAM role for the Lambda
    const role = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'));

    // // Add Axios as a dependency
    // const axiosLayer = new lambda.LayerVersion(this, 'AxiosLayer', {
    //   code: lambda.Code.fromAsset(path.join(__dirname, '../node_modules/axios')),
    //   compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    // });

    // Define the Lambda
    const lambdaFunction = new lambda.Function(this, 'LambdaCanary', {
      functionName: 'lambda-canary',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: role,
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      // layers: [axiosLayer],
    });

    // Grant the Lambda function permissions to write to the S3 bucket
    bucket.grantWrite(lambdaFunction);

    // Define the CloudWatch Event Rule to trigger the Lambda function every 2 minutes
    const rule = new events.Rule(this, 'ScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(2)),
    });

    // Define the event input with predefined URLs
    const urls = {
      Google: "https://www.google.com/",
      Youtube: "https://www.youtube.com/"
    };

    const urlsCount = Object.keys(urls).length;

    // Add the Lambda function as the target of the Event Rule
    rule.addTarget(new targets.LambdaFunction(lambdaFunction, {
      event: events.RuleTargetInput.fromObject(urls)
    }));

    // Define a custom inline policy
    const inlinePolicy = new iam.Policy(this, 'LambdaCustomPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            's3:PutObject',
            's3:GetObject',
          ],
          resources: [
            `arn:aws:s3:::${bucket.bucketName}/lambda/${this.region}/${lambdaFunction.functionName}/*`,
          ],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: [
            's3:ListAllMyBuckets',
            'xray:PutTraceSegments',
          ],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
          conditions: {
            StringEquals: {
              'cloudwatch:namespace': 'LambdaFunctionMetrics',
            },
          },
        }),
      ],
    });

    // Attach the inline policy to the role
    role.attachInlinePolicy(inlinePolicy);

    // Create SNS Topic
    const topic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Lambda Notification Topic',
    });

    // Subscribe an email endpoint to the topic (change email@example.com to your email)
    topic.addSubscription(new snsSubscriptions.EmailSubscription('taynguyen3110@gmail.com'));

    // Create CloudWatch Alarm for available URL count
    const availableURLCountMetric = new cloudwatch.Metric({
      namespace: 'LambdaFunctionMetrics',
      metricName: 'AvailableURLCount',
      statistic: 'Average',
      period: Duration.minutes(5),
    });

    const availableURLCountAlarm = new cloudwatch.Alarm(this, 'AvailableURLCountAlarm', {
      metric: availableURLCountMetric,
      threshold: urlsCount,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Alarm when the available URL count is less than the total number of URLs',
    });

    availableURLCountAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

    // Create CloudWatch Alarm for latency
    const latencyMetric = new cloudwatch.Metric({
      namespace: 'LambdaFunctionMetrics',
      metricName: 'URLLatency',
      statistic: 'Average',
      period: Duration.minutes(5),
    });

    const latencyAlarm = new cloudwatch.Alarm(this, 'LambdaLatencyAlarm', {
      metric: latencyMetric,
      threshold: 5000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when Lambda function latency exceeds 5 seconds',
    });

    latencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

  }
}

module.exports = { LambdaCanaryStack }
