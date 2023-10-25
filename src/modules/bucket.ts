import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export class Bucket {
  constructor(
    public client: S3Client,
    public bucketName: string,
    public cache: number
  ) {}
  async saveSnapshots(entity: string, face: Buffer, body: Buffer) {
    const faceUpload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName,
        Key: `entities/${entity}/face.png`,
        Body: face,
        ContentType: "image/png",
        CacheControl: `max-age=${this.cache}`,
      },
    });

    const bodyUpload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName,
        Key: `entities/${entity}/body.png`,
        Body: body,
        ContentType: "image/png",
        CacheControl: `max-age=${this.cache}`,
      },
    });

    await Promise.all([faceUpload.done(), bodyUpload.done()]);
  }
}
