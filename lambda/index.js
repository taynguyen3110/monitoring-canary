const https = require('https');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const s3 = new S3Client({ region: 'ap-southeast-2' });
const cloudwatch = new CloudWatchClient({ region: 'ap-southeast-2' });

exports.handler = async (event) => {
    const urls = event.urls || {
        Google: "https://www.google.com/",
        Youtube: "https://www.youtube.com/"
    };
    const results = [];
    let availableCount = 0;

    for (const [name, url] of Object.entries(urls)) {
        const start = Date.now();
        let status = 'unknown';
        try {
            await checkUrl(url);
            status = 'available';
            availableCount++;
        } catch (error) {
            status = 'unavailable';
        }
        const latency = Date.now() - start;
        results.push({ name, url, status, latency });

        // Push latency metric to CloudWatch
        await putMetricData('URLLatency', latency, 'Milliseconds', [{ Name: 'URL', Value: name }]);
    }

    // Push available count to CloudWatch
    await putMetricData('AvailableURLCount', availableCount, 'Count');

    const log = results.map(result => `Name: ${ result.name }, URL: ${ result.url }, Status: ${ result.status }, Latency: ${ result.latency }ms`).join('\n');
            const params = {
                Bucket: process.env.BUCKET_NAME,
                Key: `logs / ${ Date.now() }.txt`,
                Body: log,
            };

            try {
                await s3.send(new PutObjectCommand(params));
                console.log('Log file saved successfully');
            } catch (err) {
                console.error('Error saving log file', err);
            }
        };

        function checkUrl(url) {
            return new Promise((resolve, reject) => {
                https.get(url, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Status code: ${ res.statusCode }`));
                    }
                }).on('error', (err) => {
                    reject(err);
                });
            });
        }

        async function putMetricData(metricName, value, unit, dimensions = []) {
            const params = {
                Namespace: 'LambdaFunctionMetrics',
                MetricData: [
                    {
                        MetricName: metricName,
                        Dimensions: dimensions,
                        Timestamp: new Date(),
                        Unit: unit,
                        Value: value,
                    },
                ],
            };

            try {
                await cloudwatch.send(new PutMetricDataCommand(params));
                console.log(`Metric ${ metricName } with value ${ value } pushed to CloudWatch`);
            } catch (err) {
                console.error(`Error pushing metric ${ metricName } to CloudWatch`, err);
            }
        }