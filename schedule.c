#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#define MAX_LINE 2048
#define MAX_SONGS 200

#define DAYS 2
#define START_HOUR 18
#define SLOTS_PER_DAY 6
#define SLOT_CAPACITY 3

#define TOTAL_SLOTS (DAYS*SLOTS_PER_DAY)

typedef struct {
    char song[128];
    uint32_t available_mask;
    int assigned_slot; // -1 = 未排
    int available_count;
} Song;

// CSV parser 支援引號
char* read_csv_field(char *dst, char *src){
    int i=0,in_quote=0;
    if(*src=='"'){ in_quote=1; src++; }
    while(*src){
        if(in_quote){
            if(*src=='"' && (*(src+1)==',' || *(src+1)=='\0')){
                src++;
                if(*src==',') src++;
                break;
            }
        }else if(*src==','){ src++; break; }
        dst[i++]=*src++;
    }
    dst[i]='\0';
    return src;
}

// 時間 → slot
int time_to_slot(int h,int m){
    if(h<START_HOUR||h>START_HOUR+3) return -1;
    return (h-START_HOUR)*2 + (m>=30);
}

// 解析時間字串到 mask
uint32_t parse_time_ranges(const char *str,int day){
    if(strcmp(str,"都不行")==0) return 0;
    uint32_t mask=0;
    if(strcmp(str,"都可以")==0){
        for(int i=0;i<SLOTS_PER_DAY;i++)
            mask|=(1U<<(day*SLOTS_PER_DAY+i));
        return mask;
    }
    char buf[512]; strncpy(buf,str,sizeof(buf)); buf[sizeof(buf)-1]='\0';
    char *tok=strtok(buf,",");
    while(tok){
        int h1,m1,h2,m2;
        if(sscanf(tok," %d:%d-%d:%d",&h1,&m1,&h2,&m2)==4){
            int s=time_to_slot(h1,m1);
            int e=time_to_slot(h2,m2);
            if(s>=0&&e>=0){
                e--;
                for(int i=s;i<=e && i<SLOTS_PER_DAY;i++)
                    mask|=(1U<<(day*SLOTS_PER_DAY+i));
            }
        }
        tok=strtok(NULL,",");
    }
    return mask;
}

// slot → 時間字串
void slot_to_text(int slot,char *time_out){
    int start = START_HOUR*60 + (slot%SLOTS_PER_DAY)*30;
    int end = start+30;
    sprintf(time_out,"%02d:%02d-%02d:%02d",start/60,start%60,end/60,end%60);
}

int slot_count[TOTAL_SLOTS];

// 嘗試將歌曲排進可用時段
int assign_song(Song *s){
    for(int b=0;b<TOTAL_SLOTS;b++){
        if((s->available_mask & (1U<<b)) && slot_count[b]<SLOT_CAPACITY){
            s->assigned_slot=b;
            slot_count[b]++;
            return 1;
        }
    }
    s->assigned_slot=-1;
    return 0;
}

int cmp_song(const void *a,const void *b){
    return ((Song*)a)->available_count - ((Song*)b)->available_count;
}

int main(void){
    FILE *fp=fopen("data.csv","r");
    if(!fp){ perror("fopen"); return 1; }

    Song songs[MAX_SONGS];
    int song_count=0;
    char line[MAX_LINE],tmp[512];

    fgets(line,sizeof(line),fp); // skip header
    while(fgets(line,sizeof(line),fp) && song_count<MAX_SONGS){
        Song *s=&songs[song_count];
        memset(s,0,sizeof(*s));
        s->assigned_slot=-1;

        char *p=line;
        p=read_csv_field(tmp,p); // timestamp
        p=read_csv_field(s->song,p); // song name

        for(int d=0;d<DAYS;d++){
            p=read_csv_field(tmp,p);
            s->available_mask |= parse_time_ranges(tmp,d);
        }

        s->available_count = __builtin_popcount(s->available_mask);
        song_count++;
    }
    fclose(fp);

    qsort(songs,song_count,sizeof(Song),cmp_song);
    memset(slot_count,0,sizeof(slot_count));

    for(int i=0;i<song_count;i++)
        assign_song(&songs[i]);

    FILE *out=fopen("result.csv","w");
    if(!out){ perror("fopen"); return 1; }

    // CSV 標題
    fprintf(out,"時段,第一天,第二天\n");

    char time_str[16];
    for(int s=0;s<SLOTS_PER_DAY;s++){
        slot_to_text(s,time_str);
        fprintf(out,"%s",time_str);

        for(int d=0;d<DAYS;d++){
            fprintf(out,",");
            int first=1;
            for(int i=0;i<song_count;i++){
                if(songs[i].assigned_slot == s + d*SLOTS_PER_DAY){
                    if(!first) fprintf(out,"、");
                    fprintf(out,"%s",songs[i].song);
                    first=0;
                }
            }
        }
        fprintf(out,"\n");
    }

    // 輸出未排入歌曲
    fprintf(out,"無法排入,");
    int first=1;
    for(int i=0;i<song_count;i++){
        if(songs[i].assigned_slot==-1){
            if(!first) fprintf(out,"、");
            fprintf(out,"%s",songs[i].song);
            first=0;
        }
    }
    fprintf(out,"\n");

    fclose(out);
    printf("✅ 排程完成，輸出 result.csv\n");
    return 0;
}